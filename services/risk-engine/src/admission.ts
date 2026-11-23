import type { FillDto, MarginMode, OrderSource, PlaceOrderResult } from '@gocrypto/shared-types';
import {
  AppError,
  type Core,
  type EngineGateway,
  type EngineResult,
  type MarketInfo,
  type NewOrderInput,
  type OrderRow,
  type Tx,
  evaluateAccount,
  futuresReserve,
  initialMarginFor,
  isDuplicateKeyError,
  key,
  metrics,
  newClientOrderId,
  optionsReserve,
  positionKey,
  spotReserve,
} from '@gocrypto/server-core';
import {
  D,
  type Decimal,
  ZERO,
  checkPrice,
  checkQuantity,
  dmax,
  dmin,
  FILTER_MESSAGES,
  type FilterViolation,
  maintenanceMargin,
  notional,
  q18,
  q18Up,
  toPlain,
  unrealizedPnl,
} from '@gocrypto/trading-utils';
import type { FuturesOrderInput, OcoOrderInput, OptionsOrderInput, SpotOrderInput } from '@gocrypto/validation';
import { assertLeverageAllowed, bandedPrice, isMarketType, isTriggerType, isTriggered, maxPositionNotional } from './rules';

export interface OrderContext {
  source: OrderSource;
  /** Skip per-user rate/notional limits (system accounts). */
  system?: boolean;
  /** Wait for the engine result before returning (default true). */
  awaitEngine?: boolean;
}

function filterError(v: FilterViolation, details?: unknown): AppError {
  return new AppError('FILTER_VIOLATION', FILTER_MESSAGES[v], { details: { violation: v, ...((details as object) ?? {}) } });
}

/**
 * Risk engine order admission. Every order passes:
 *   authentication (caller) -> account status -> market status -> filters -> risk limits
 *   -> reservation of funds/margin inside a DB transaction (row lock) -> order insert -> engine.
 * Nothing financial is taken from the client: prices for reservations come from the engine's
 * order book snapshot / mark price, balances and fees from the database.
 */
export class OrderAdmissionService {
  constructor(
    private readonly core: Core,
    private readonly engine: EngineGateway,
  ) {}

  // ───────────────────────────── shared ─────────────────────────────

  private requireTradingMarket(symbol: string, type: MarketInfo['type']): MarketInfo {
    const m = this.core.markets.require(symbol, type);
    if (m.status !== 'TRADING') throw new AppError('MARKET_CLOSED', `${symbol} is not open for trading`);
    return m;
  }

  private async limits(userId: string, ctx: OrderContext, notionalUsd: Decimal): Promise<void> {
    if (ctx.system) return;
    const maxOpen = Number(this.core.settings.get('risk.max_open_orders'));
    if ((await this.core.orders.countOpen(userId)) >= maxOpen) {
      throw new AppError('MAX_OPEN_ORDERS', `You can have at most ${maxOpen} open orders`);
    }
    const maxNotional = D(this.core.settings.get('risk.max_order_notional_usd'));
    if (notionalUsd.gt(maxNotional)) {
      throw new AppError('MAX_ORDER_SIZE', `Order value exceeds the maximum of ${maxNotional.toFixed()} USD`);
    }
    const day = new Date().toISOString().slice(0, 10);
    const k = key('risk', 'daily', userId, day);
    const used = D((await this.core.redis.main.get(k)) ?? '0');
    const dailyMax = D(this.core.settings.get('risk.daily_order_notional_usd'));
    if (used.plus(notionalUsd).gt(dailyMax)) {
      throw new AppError('DAILY_LIMIT_EXCEEDED', 'Daily trading volume limit reached');
    }
  }

  private async recordDaily(userId: string, ctx: OrderContext, notionalUsd: Decimal): Promise<void> {
    if (ctx.system || notionalUsd.lte(0)) return;
    const day = new Date().toISOString().slice(0, 10);
    const k = key('risk', 'daily', userId, day);
    const next = D((await this.core.redis.main.get(k)) ?? '0').plus(notionalUsd);
    await this.core.redis.main.set(k, next.toFixed(2), 'EX', 2 * 86_400);
  }

  private async referencePrice(market: MarketInfo, side: 'BUY' | 'SELL'): Promise<Decimal> {
    const { bid, ask } = await this.core.prices.bestBidAsk(market.symbol);
    const best = side === 'BUY' ? ask : bid;
    if (best) return D(best);
    if (market.type === 'FUTURES') {
      const mp = await this.core.prices.markPrice(market.symbol);
      if (mp) return D(mp.markPrice);
    }
    const last = await this.core.prices.lastPrice(market.symbol);
    if (last) return D(last);
    throw new AppError('NO_LIQUIDITY', `No liquidity available for ${market.symbol}`);
  }

  private async lastPrice(market: MarketInfo, workingType: 'MARK_PRICE' | 'LAST_PRICE' = 'LAST_PRICE'): Promise<Decimal | null> {
    if (workingType === 'MARK_PRICE' && market.type === 'FUTURES') {
      const mp = await this.core.prices.markPrice(market.symbol);
      if (mp) return D(mp.markPrice);
    }
    const p = await this.core.prices.lastPrice(market.symbol);
    return p ? D(p) : null;
  }

  private async insertOrder(tx: Tx, input: NewOrderInput): Promise<string> {
    try {
      const id = await this.core.orders.insert(tx, input);
      await this.core.orders.addHistory(tx, [{ orderId: id, userId: input.userId, event: 'CREATED', status: 'NEW' }]);
      return id;
    } catch (e) {
      if (isDuplicateKeyError(e, 'uq_orders_client')) throw new AppError('DUPLICATE_ORDER', 'An order with this clientOrderId already exists');
      throw e;
    }
  }

  private async dispatch(orderId: string, market: MarketInfo, trigger: boolean, ctx: OrderContext): Promise<PlaceOrderResult> {
    let engineResult: EngineResult | null = null;
    if (trigger) {
      this.core.bus.emit('order.trigger', { action: 'added', orderId, marketId: market.id });
    } else {
      engineResult = await this.engine.submit({ kind: 'NEW', orderId, marketId: market.id }, { awaitResult: ctx.awaitEngine !== false });
    }
    const row = (await this.core.orders.find(orderId))!;
    metrics.ordersTotal.inc({ market_type: market.type, type: row.type, result: row.status });
    let fills: FillDto[] = [];
    if (D(row.filled_quantity).gt(0)) {
      fills = (await this.core.orders.fills(String(row.user_id), { limit: 100, orderId })).items;
    }
    if (engineResult && !engineResult.ok && engineResult.error && row.status === 'REJECTED') {
      throw new AppError(engineResult.error.code, engineResult.error.message, { details: { order: this.core.orders.toDto(row) } });
    }
    return { order: this.core.orders.toDto(row), fills };
  }

  // ───────────────────────────── spot ─────────────────────────────

  async placeSpotOrder(userId: string, input: SpotOrderInput, ctx: OrderContext): Promise<PlaceOrderResult> {
    await this.core.users.assertCanTrade(userId);
    const market = this.requireTradingMarket(input.symbol, 'SPOT');
    const type = input.type;
    const isMarket = isMarketType(type);
    const trigger = isTriggerType(type);
    if (input.price) {
      const v = checkPrice(input.price, market);
      if (v) throw filterError(v);
    }
    if (input.stopPrice) {
      const v = checkPrice(input.stopPrice, market);
      if (v) throw filterError(v);
    }
    if (input.quantity) {
      const v = checkQuantity(input.quantity, market, isMarket);
      if (v) throw filterError(v);
    }
    if (trigger) {
      const last = await this.lastPrice(market);
      if (last && isTriggered(type, input.side, input.stopPrice!, last)) {
        throw new AppError('INVALID_ORDER', 'Trigger price would trigger immediately; use a market or limit order instead');
      }
    }

    // Reservation (computed server-side from engine prices, never from the client).
    let reserve: Decimal;
    let refPrice: Decimal;
    if (input.side === 'BUY') {
      if (input.quoteQuantity) {
        reserve = D(input.quoteQuantity);
        refPrice = await this.referencePrice(market, 'BUY');
      } else if (!isMarket) {
        refPrice = D(input.price!);
        reserve = spotReserve('BUY', input.quantity!, input.price!);
      } else {
        refPrice = trigger ? D(input.stopPrice!) : await this.referencePrice(market, 'BUY');
        reserve = q18Up(D(input.quantity!).mul(bandedPrice('BUY', refPrice, market.priceBand)));
      }
    } else {
      refPrice = !isMarket ? D(input.price!) : trigger ? D(input.stopPrice!) : await this.referencePrice(market, 'SELL');
      reserve = spotReserve('SELL', input.quantity!, null);
    }
    const notionalQuote = input.quoteQuantity ? D(input.quoteQuantity) : D(input.quantity!).mul(refPrice);
    if (notionalQuote.lt(market.minNotional)) throw filterError('NOTIONAL_BELOW_MIN', { minNotional: market.minNotional });
    const notionalUsd = await this.core.prices.toUsd(market.quote, notionalQuote);
    await this.limits(userId, ctx, notionalUsd);

    const lockAsset = input.side === 'BUY' ? market.quoteAssetId : market.baseAssetId;
    await this.core.wallet.ensureWallets(this.core.db, [{ userId, assetId: lockAsset, account: 'SPOT' }]);
    const orderId = await this.core.db.transaction(async (tx) => {
      const id = await this.insertOrder(tx, {
        userId,
        marketId: market.id,
        marketType: 'SPOT',
        clientOrderId: input.clientOrderId ?? newClientOrderId(),
        side: input.side,
        type,
        timeInForce: input.postOnly ? 'GTX' : (input.timeInForce ?? 'GTC'),
        triggerState: trigger ? 'PENDING' : 'NONE',
        price: input.price ?? null,
        stopPrice: input.stopPrice ?? null,
        quantity: input.quantity ?? null,
        quoteQuantity: input.quoteQuantity ?? null,
        postOnly: input.postOnly,
        lockAssetId: lockAsset,
        lockedAmount: q18(reserve).toFixed(18),
        source: ctx.source,
      });
      await this.core.wallet.apply(tx, [
        {
          userId,
          assetId: lockAsset,
          account: 'SPOT',
          available: reserve.neg(),
          locked: reserve,
          type: 'ORDER_LOCK',
          refType: 'ORDER',
          refId: id,
          idemKey: `ord:${id}:lock`,
        },
      ]);
      return id;
    });
    await this.recordDaily(userId, ctx, notionalUsd);
    return this.dispatch(orderId, market, trigger, ctx);
  }

  /** One-cancels-the-other: a limit (take-profit) leg plus a stop leg sharing one reservation. */
  async placeOco(userId: string, input: OcoOrderInput, ctx: OrderContext): Promise<{ listId: string; orders: PlaceOrderResult[] }> {
    await this.core.users.assertCanTrade(userId);
    const market = this.requireTradingMarket(input.symbol, 'SPOT');
    for (const p of [input.price, input.stopPrice, input.stopLimitPrice].filter(Boolean) as string[]) {
      const v = checkPrice(p, market);
      if (v) throw filterError(v);
    }
    const qv = checkQuantity(input.quantity, market);
    if (qv) throw filterError(qv);
    const last = await this.lastPrice(market);
    if (!last) throw new AppError('NO_LIQUIDITY', 'No reference price available');
    // SELL OCO: take profit above market, stop below. BUY OCO: limit below market, stop above.
    if (input.side === 'SELL' && !(D(input.price).gt(last) && D(input.stopPrice).lt(last))) {
      throw new AppError('INVALID_ORDER', 'For a sell OCO the limit price must be above and the stop price below the last price');
    }
    if (input.side === 'BUY' && !(D(input.price).lt(last) && D(input.stopPrice).gt(last))) {
      throw new AppError('INVALID_ORDER', 'For a buy OCO the limit price must be below and the stop price above the last price');
    }
    const stopType = input.stopLimitPrice ? 'STOP_LIMIT' : 'STOP_MARKET';
    const stopExec = input.stopLimitPrice ? D(input.stopLimitPrice) : bandedPrice(input.side, input.stopPrice, market.priceBand);
    const reserve =
      input.side === 'SELL'
        ? D(input.quantity)
        : q18Up(D(input.quantity).mul(D(input.price).gt(stopExec) ? input.price : stopExec));
    const notionalQuote = D(input.quantity).mul(input.price);
    if (notionalQuote.lt(market.minNotional)) throw filterError('NOTIONAL_BELOW_MIN');
    await this.limits(userId, ctx, await this.core.prices.toUsd(market.quote, notionalQuote));
    const lockAsset = input.side === 'BUY' ? market.quoteAssetId : market.baseAssetId;
    await this.core.wallet.ensureWallets(this.core.db, [{ userId, assetId: lockAsset, account: 'SPOT' }]);
    const base = input.clientOrderId ?? newClientOrderId('oco');
    const { listId, limitId, stopId } = await this.core.db.transaction(async (tx) => {
      const list = await tx.execute('INSERT INTO order_lists (user_id, market_id) VALUES (?, ?)', [userId, market.id]);
      const limitId = await this.insertOrder(tx, {
        userId,
        marketId: market.id,
        marketType: 'SPOT',
        clientOrderId: `${base}-L`.slice(0, 40),
        side: input.side,
        type: 'LIMIT',
        timeInForce: 'GTC',
        triggerState: 'NONE',
        price: input.price,
        stopPrice: null,
        quantity: input.quantity,
        quoteQuantity: null,
        lockAssetId: lockAsset,
        lockedAmount: q18(reserve).toFixed(18),
        ocoGroupId: list.insertId,
        source: ctx.source,
      });
      const stopId = await this.insertOrder(tx, {
        userId,
        marketId: market.id,
        marketType: 'SPOT',
        clientOrderId: `${base}-S`.slice(0, 40),
        side: input.side,
        type: stopType,
        timeInForce: 'GTC',
        triggerState: 'PENDING',
        price: input.stopLimitPrice ?? null,
        stopPrice: input.stopPrice,
        quantity: input.quantity,
        quoteQuantity: null,
        lockAssetId: lockAsset,
        lockedAmount: '0',
        ocoGroupId: list.insertId,
        source: ctx.source,
      });
      await this.core.wallet.apply(tx, [
        {
          userId,
          assetId: lockAsset,
          account: 'SPOT',
          available: reserve.neg(),
          locked: reserve,
          type: 'ORDER_LOCK',
          refType: 'ORDER_LIST',
          refId: list.insertId,
          idemKey: `oco:${list.insertId}:lock`,
        },
      ]);
      return { listId: list.insertId, limitId, stopId };
    });
    const limit = await this.dispatch(limitId, market, false, ctx);
    const stop = await this.dispatch(stopId, market, true, ctx);
    return { listId, orders: [limit, stop] };
  }

  // ───────────────────────────── futures ─────────────────────────────

  async placeFuturesOrder(userId: string, input: FuturesOrderInput, ctx: OrderContext): Promise<PlaceOrderResult> {
    await this.core.users.assertCanTrade(userId);
    const market = this.requireTradingMarket(input.symbol, 'FUTURES');
    const fut = market.futures!;
    const type = input.type;
    const isMarket = isMarketType(type);
    const trigger = isTriggerType(type);
    const closePosition = Boolean(input.closePosition);
    const reduceOnly = Boolean(input.reduceOnly) || closePosition;
    if (input.price) {
      const v = checkPrice(input.price, market);
      if (v) throw filterError(v);
    }
    if (input.stopPrice) {
      const v = checkPrice(input.stopPrice, market);
      if (v) throw filterError(v);
    }
    if (input.quantity) {
      const v = checkQuantity(input.quantity, market, isMarket);
      if (v) throw filterError(v);
    }
    const workingType = input.workingType ?? 'MARK_PRICE';
    if (trigger) {
      const last = await this.lastPrice(market, workingType);
      if (last && isTriggered(type, input.side, input.stopPrice!, last)) {
        throw new AppError('INVALID_ORDER', 'Trigger price would trigger immediately');
      }
    }
    const settings = await this.core.futures.settings(userId, market);
    const position = await this.core.db.one<{ side: 'LONG' | 'SHORT' | null; quantity: string; entry_price: string }>(
      'SELECT side, quantity, entry_price FROM futures_positions WHERE user_id = ? AND market_id = ?',
      [userId, market.id],
    );
    const posQty = position?.side ? D(position.quantity) : ZERO;
    const closesPosition = position?.side && posQty.gt(0) && (position.side === 'LONG' ? input.side === 'SELL' : input.side === 'BUY');
    if (reduceOnly && !closePosition && !closesPosition) {
      throw new AppError('REDUCE_ONLY_REJECTED', 'Reduce-only order would increase the position');
    }

    const refPrice = !isMarket ? D(input.price!) : trigger ? D(input.stopPrice!) : await this.referencePrice(market, input.side);
    const qty = input.quantity ? D(input.quantity) : posQty;
    if (!closePosition && qty.mul(refPrice).lt(market.minNotional)) throw filterError('NOTIONAL_BELOW_MIN');

    // Leverage / position size limits for the resulting position.
    if (!reduceOnly) {
      const sameSide = position?.side && (position.side === 'LONG' ? input.side === 'BUY' : input.side === 'SELL');
      const resulting = (sameSide ? posQty : ZERO).plus(qty).mul(refPrice);
      const check = assertLeverageAllowed(fut.riskTiers, resulting, settings.leverage);
      if (!check.ok) {
        throw new AppError('LEVERAGE_TOO_HIGH', `Max leverage for this position size is ${check.max}x. Reduce leverage or size.`);
      }
      const cap = maxPositionNotional(fut.riskTiers);
      if (cap && resulting.gt(cap)) throw new AppError('POSITION_LIMIT_EXCEEDED', `Maximum position size is ${cap.toFixed()} USDT`);
      await this.limits(userId, ctx, qty.mul(refPrice));
    }

    const flags = await this.core.users.flags(userId);
    const rates = await this.core.fees.ratesFor({ id: userId, vipTier: flags.vipTier, isSystem: flags.isSystem }, market);
    const reserve = reduceOnly
      ? ZERO
      : futuresReserve({
          market,
          side: input.side,
          qty,
          price: isMarket ? bandedPrice(input.side, refPrice, market.priceBand) : refPrice,
          leverage: settings.leverage,
          takerRate: rates.taker,
          reduceOnly,
        });
    const settle = market.quoteAssetId;
    const marks = await this.markMap();
    await this.core.wallet.ensureWallets(this.core.db, [{ userId, assetId: settle, account: 'FUTURES' }]);

    const orderId = await this.core.db.transaction(async (tx) => {
      const id = await this.insertOrder(tx, {
        userId,
        marketId: market.id,
        marketType: 'FUTURES',
        clientOrderId: input.clientOrderId ?? newClientOrderId(),
        side: input.side,
        type,
        timeInForce: input.postOnly ? 'GTX' : (input.timeInForce ?? 'GTC'),
        triggerState: trigger ? 'PENDING' : 'NONE',
        workingType,
        price: input.price ?? null,
        stopPrice: input.stopPrice ?? null,
        quantity: closePosition ? null : qty.toFixed(),
        quoteQuantity: null,
        reduceOnly,
        postOnly: input.postOnly,
        closePosition,
        leverage: settings.leverage,
        marginMode: settings.marginMode,
        lockAssetId: settle,
        lockedAmount: q18(reserve).toFixed(18),
        source: ctx.source,
      });
      if (reserve.gt(0)) await this.lockMargin(tx, userId, settle, 'FUTURES', reserve, id, marks);
      return id;
    });

    // Attached take-profit / stop-loss (close-position trigger orders on the mark price).
    if (input.takeProfitPrice || input.stopLossPrice) {
      await this.setPositionTpSl(userId, market.symbol, { takeProfitPrice: input.takeProfitPrice, stopLossPrice: input.stopLossPrice }, ctx, {
        side: input.side === 'BUY' ? 'LONG' : 'SHORT',
        parentOrderId: orderId,
      });
    }
    return this.dispatch(orderId, market, trigger, ctx);
  }

  private async markMap(): Promise<Map<number, Decimal>> {
    return this.core.futures.markPrices(this.core.markets.list('FUTURES'));
  }

  /**
   * Lock margin for an order. Holding the settle-asset wallet lock serialises against settlement,
   * so the positions read here cannot change underneath us. Unrealised losses reduce what is usable.
   */
  private async lockMargin(
    tx: Tx,
    userId: string,
    assetId: number,
    account: 'FUTURES' | 'OPTIONS',
    amount: Decimal,
    orderId: string,
    marks: Map<number, Decimal>,
  ): Promise<void> {
    const wallets = await this.core.wallet.lockWallets(tx, [{ userId, assetId, account }]);
    const w = [...wallets.values()][0]!;
    let usable = w.available;
    if (account === 'FUTURES') {
      const positions = await this.core.futures.positionsOf(userId, tx);
      const items = positions.map((pos) => ({ pos, market: this.core.markets.requireId(pos.marketId), mark: marks.get(pos.marketId) ?? pos.entry }));
      const acct = evaluateAccount({ available: w.available, locked: w.locked }, items, ZERO);
      usable = w.available.plus(dmin(ZERO, acct.crossUnrealizedPnl));
    }
    if (usable.lt(amount)) {
      throw new AppError('INSUFFICIENT_MARGIN', `Insufficient margin: requires ${toPlain(amount.toDecimalPlaces(4))} USDT`, {
        details: { required: toPlain(amount), available: toPlain(dmax(ZERO, usable)) },
      });
    }
    await this.core.wallet.apply(
      tx,
      [{ userId, assetId, account, available: amount.neg(), locked: amount, type: 'ORDER_LOCK', refType: 'ORDER', refId: orderId, idemKey: `ord:${orderId}:lock` }],
      wallets,
    );
  }

  async setLeverage(userId: string, symbol: string, leverage: number): Promise<{ symbol: string; leverage: number; marginMode: MarginMode; maxLeverage: number }> {
    const market = this.core.futures.requireFutures(symbol);
    const fut = market.futures!;
    if (leverage < 1 || leverage > fut.maxLeverage) throw new AppError('LEVERAGE_TOO_HIGH', `Leverage must be between 1 and ${fut.maxLeverage}`);
    const settings = await this.core.futures.settings(userId, market);
    const settle = market.quoteAssetId;
    const marks = await this.markMap();
    const mark = marks.get(market.id);
    await this.core.wallet.ensureWallets(this.core.db, [{ userId, assetId: settle, account: 'FUTURES' }]);
    await this.core.db.transaction(async (tx) => {
      const wallets = await this.core.wallet.lockWallets(tx, [{ userId, assetId: settle, account: 'FUTURES' }]);
      const open = await tx.one<{ c: number }>(
        "SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND market_id = ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED') AND reduce_only = 0",
        [userId, market.id],
      );
      if (Number(open?.c ?? 0) > 0) throw new AppError('OPEN_ORDERS_EXIST', 'Cancel open orders on this contract before changing leverage');
      const positions = await this.core.futures.lockPositions(tx, [{ userId, marketId: market.id, leverage, marginMode: settings.marginMode }]);
      const pos = positions.get(positionKey(userId, market.id))!;
      if (pos.side && pos.qty.gt(0)) {
        const notionalAtMark = notional(pos.qty, mark ?? pos.entry);
        const check = assertLeverageAllowed(fut.riskTiers, notionalAtMark, leverage);
        if (!check.ok) throw new AppError('LEVERAGE_TOO_HIGH', `Max leverage for your position size is ${check.max}x`);
        const required = initialMarginFor(pos.qty, pos.entry, leverage);
        const diff = required.minus(pos.margin);
        if (diff.gt(0)) {
          const w = [...wallets.values()][0]!;
          if (w.available.lt(diff)) throw new AppError('INSUFFICIENT_MARGIN', 'Not enough available balance to lower leverage');
          await this.core.wallet.apply(tx, [{ userId, assetId: settle, account: 'FUTURES', available: diff.neg(), locked: diff, type: 'MARGIN_LOCK', refType: 'LEVERAGE', refId: market.symbol }], wallets);
        } else if (diff.lt(0)) {
          // Releasing margin must keep the position safely above maintenance.
          const mm = maintenanceMargin(fut.riskTiers, pos.qty, mark ?? pos.entry);
          const upnl = unrealizedPnl(pos.side, pos.qty, pos.entry, mark ?? pos.entry);
          if (pos.marginMode === 'ISOLATED' && required.plus(upnl).lte(mm.mul(2))) {
            throw new AppError('INSUFFICIENT_MARGIN', 'Raising leverage would put the position too close to liquidation');
          }
          await this.core.wallet.apply(tx, [{ userId, assetId: settle, account: 'FUTURES', available: diff.neg(), locked: diff, type: 'MARGIN_UNLOCK', refType: 'LEVERAGE', refId: market.symbol }], wallets);
        }
        pos.margin = required;
        pos.leverage = leverage;
        pos.dirty = true;
        await this.core.futures.savePositions(tx, [pos]);
      }
      await this.core.futures.saveSettings(tx, userId, market.id, leverage, settings.marginMode);
    });
    this.core.bus.emit('position.changed', { userId, marketId: market.id, marketType: 'FUTURES' });
    return { symbol, leverage, marginMode: settings.marginMode, maxLeverage: fut.maxLeverage };
  }

  async setMarginMode(userId: string, symbol: string, marginMode: MarginMode) {
    const market = this.core.futures.requireFutures(symbol);
    const settings = await this.core.futures.settings(userId, market);
    if (settings.marginMode === marginMode) return { symbol, leverage: settings.leverage, marginMode, maxLeverage: market.futures!.maxLeverage };
    const pos = await this.core.db.one<{ quantity: string }>("SELECT quantity FROM futures_positions WHERE user_id = ? AND market_id = ? AND status = 'OPEN'", [
      userId,
      market.id,
    ]);
    if (pos && D(pos.quantity).gt(0)) throw new AppError('POSITION_EXISTS', 'Close the position before changing margin mode');
    const open = await this.core.db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND market_id = ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
      [userId, market.id],
    );
    if (Number(open?.c ?? 0) > 0) throw new AppError('OPEN_ORDERS_EXIST', 'Cancel open orders before changing margin mode');
    await this.core.futures.saveSettings(this.core.db, userId, market.id, settings.leverage, marginMode);
    await this.core.db.execute('UPDATE futures_positions SET margin_mode = ? WHERE user_id = ? AND market_id = ? AND quantity = 0', [
      marginMode,
      userId,
      market.id,
    ]);
    return { symbol, leverage: settings.leverage, marginMode, maxLeverage: market.futures!.maxLeverage };
  }

  /** Add or remove isolated margin. */
  async adjustIsolatedMargin(userId: string, symbol: string, amount: string, direction: 'ADD' | 'REMOVE') {
    const market = this.core.futures.requireFutures(symbol);
    const settle = market.quoteAssetId;
    const amt = D(amount);
    const mark = (await this.markMap()).get(market.id);
    await this.core.db.transaction(async (tx) => {
      const wallets = await this.core.wallet.lockWallets(tx, [{ userId, assetId: settle, account: 'FUTURES' }]);
      const positions = await this.core.futures.lockPositions(tx, [{ userId, marketId: market.id }]);
      const pos = positions.get(positionKey(userId, market.id))!;
      if (!pos.side || pos.qty.isZero()) throw new AppError('NO_POSITION', 'No open position');
      if (pos.marginMode !== 'ISOLATED') throw new AppError('INVALID_ORDER', 'Margin can only be adjusted for isolated positions');
      const w = [...wallets.values()][0]!;
      if (direction === 'ADD') {
        if (w.available.lt(amt)) throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient available balance');
        await this.core.wallet.apply(tx, [{ userId, assetId: settle, account: 'FUTURES', available: amt.neg(), locked: amt, type: 'MARGIN_LOCK', refType: 'ISOLATED_MARGIN', refId: symbol }], wallets);
        pos.margin = pos.margin.plus(amt);
      } else {
        const m = mark ?? pos.entry;
        const im = initialMarginFor(pos.qty, m, pos.leverage);
        const upnl = unrealizedPnl(pos.side, pos.qty, pos.entry, m);
        const removable = dmax(ZERO, pos.margin.plus(dmin(ZERO, upnl)).minus(im));
        if (amt.gt(removable)) throw new AppError('INSUFFICIENT_MARGIN', `At most ${toPlain(removable.toDecimalPlaces(4))} USDT can be removed`);
        await this.core.wallet.apply(tx, [{ userId, assetId: settle, account: 'FUTURES', available: amt, locked: amt.neg(), type: 'MARGIN_UNLOCK', refType: 'ISOLATED_MARGIN', refId: symbol }], wallets);
        pos.margin = pos.margin.minus(amt);
      }
      pos.dirty = true;
      await this.core.futures.savePositions(tx, [pos]);
    });
    this.core.bus.emit('position.changed', { userId, marketId: market.id, marketType: 'FUTURES' });
  }

  /** Market-close (part of) a position with a reduce-only order. */
  async closePosition(userId: string, symbol: string, quantity: string | undefined, ctx: OrderContext): Promise<PlaceOrderResult> {
    const market = this.core.futures.requireFutures(symbol);
    const pos = await this.core.db.one<{ side: 'LONG' | 'SHORT' | null; quantity: string }>(
      'SELECT side, quantity FROM futures_positions WHERE user_id = ? AND market_id = ?',
      [userId, market.id],
    );
    if (!pos?.side || D(pos.quantity).isZero()) throw new AppError('NO_POSITION', 'No open position');
    const qty = quantity ? dmin(D(quantity), D(pos.quantity)) : D(pos.quantity);
    return this.placeFuturesOrder(
      userId,
      { symbol, side: pos.side === 'LONG' ? 'SELL' : 'BUY', type: 'MARKET', quantity: qty.toFixed(), reduceOnly: true },
      ctx,
    );
  }

  /** Replace the position's TP/SL (close-position trigger orders on the mark price). */
  async setPositionTpSl(
    userId: string,
    symbol: string,
    input: { takeProfitPrice?: string | null; stopLossPrice?: string | null },
    ctx: OrderContext,
    hint?: { side: 'LONG' | 'SHORT'; parentOrderId?: string },
  ): Promise<PlaceOrderResult[]> {
    const market = this.core.futures.requireFutures(symbol);
    let side = hint?.side;
    if (!side) {
      const pos = await this.core.db.one<{ side: 'LONG' | 'SHORT' | null; quantity: string }>(
        'SELECT side, quantity FROM futures_positions WHERE user_id = ? AND market_id = ?',
        [userId, market.id],
      );
      if (!pos?.side || D(pos.quantity).isZero()) throw new AppError('NO_POSITION', 'No open position');
      side = pos.side;
    }
    const mark = (await this.markMap()).get(market.id);
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    const existing = await this.core.db.query<{ id: string; type: string }>(
      `SELECT id, type FROM orders WHERE user_id = ? AND market_id = ? AND close_position = 1 AND status = 'NEW' AND trigger_state = 'PENDING'`,
      [userId, market.id],
    );
    const results: PlaceOrderResult[] = [];
    const legs: [('TAKE_PROFIT_MARKET' | 'STOP_MARKET'), string | null | undefined][] = [
      ['TAKE_PROFIT_MARKET', input.takeProfitPrice],
      ['STOP_MARKET', input.stopLossPrice],
    ];
    for (const [type, price] of legs) {
      if (price === undefined) continue;
      for (const e of existing.filter((x) => x.type === type)) {
        await this.engine.submit({ kind: 'CANCEL', orderId: String(e.id), marketId: market.id, userId, reason: 'USER' });
      }
      if (price === null) continue;
      const v = checkPrice(price, market);
      if (v) throw filterError(v);
      if (mark) {
        const wrongTp = type === 'TAKE_PROFIT_MARKET' && (side === 'LONG' ? D(price).lte(mark) : D(price).gte(mark));
        const wrongSl = type === 'STOP_MARKET' && (side === 'LONG' ? D(price).gte(mark) : D(price).lte(mark));
        if (wrongTp) throw new AppError('INVALID_ORDER', 'Take-profit price must be beyond the current mark price');
        if (wrongSl) throw new AppError('INVALID_ORDER', 'Stop-loss price must be on the losing side of the mark price');
      }
      const id = await this.core.db.transaction((tx) =>
        this.insertOrder(tx, {
          userId,
          marketId: market.id,
          marketType: 'FUTURES',
          clientOrderId: newClientOrderId(type === 'STOP_MARKET' ? 'sl' : 'tp'),
          side: closeSide,
          type,
          timeInForce: 'GTC',
          triggerState: 'PENDING',
          workingType: 'MARK_PRICE',
          price: null,
          stopPrice: price,
          quantity: null,
          quoteQuantity: null,
          reduceOnly: true,
          closePosition: true,
          lockAssetId: market.quoteAssetId,
          lockedAmount: '0',
          parentOrderId: hint?.parentOrderId ?? null,
          source: ctx.source,
        }),
      );
      results.push(await this.dispatch(id, market, true, ctx));
    }
    return results;
  }

  // ───────────────────────────── options ─────────────────────────────

  async placeOptionsOrder(userId: string, input: OptionsOrderInput, ctx: OrderContext): Promise<PlaceOrderResult> {
    const flags = await this.core.users.assertCanTrade(userId);
    const market = this.requireTradingMarket(input.symbol, 'OPTIONS');
    const opt = market.option!;
    if (opt.expiryAt - Date.now() < 60_000) throw new AppError('CONTRACT_EXPIRED', 'This option is about to expire');
    if (input.price) {
      const v = checkPrice(input.price, market);
      if (v) throw filterError(v);
    }
    const qv = checkQuantity(input.quantity, market, input.type === 'MARKET');
    if (qv) throw filterError(qv);
    const index = await this.core.options.indexFor(opt.underlying);
    if (!index) throw new AppError('SERVICE_UNAVAILABLE', 'Index price unavailable');
    const { mark } = this.core.options.markFor(market, index, await this.core.options.baseIv(opt.underlying));
    const pos = await this.core.db.one<{ side: 'LONG' | 'SHORT' | null; quantity: string }>(
      'SELECT side, quantity FROM options_positions WHERE user_id = ? AND market_id = ?',
      [userId, market.id],
    );
    const posQty = pos?.side ? D(pos.quantity) : ZERO;
    if (input.reduceOnly) {
      const closes = pos?.side && (pos.side === 'LONG' ? input.side === 'SELL' : input.side === 'BUY');
      if (!closes || posQty.isZero()) throw new AppError('REDUCE_ONLY_REJECTED', 'Reduce-only order would increase the position');
    }
    let execPrice: Decimal;
    if (input.type === 'LIMIT') execPrice = D(input.price!);
    else {
      const { bid, ask } = await this.core.prices.bestBidAsk(market.symbol);
      const best = input.side === 'BUY' ? ask : bid;
      if (!best) throw new AppError('NO_LIQUIDITY', 'No liquidity for this option');
      execPrice = bandedPrice(input.side, best, market.priceBand);
    }
    const rates = await this.core.fees.ratesFor({ id: userId, vipTier: flags.vipTier, isSystem: flags.isSystem }, market);
    const reserve = optionsReserve({
      market,
      side: input.side,
      qty: input.quantity,
      price: execPrice,
      indexPrice: index,
      markPrice: mark,
      feeRate: rates.taker,
      closableLong: pos?.side === 'LONG' ? posQty : ZERO,
      closableShort: pos?.side === 'SHORT' ? posQty : ZERO,
    });
    await this.limits(userId, ctx, D(input.quantity).mul(execPrice));
    const settle = market.quoteAssetId;
    await this.core.wallet.ensureWallets(this.core.db, [{ userId, assetId: settle, account: 'OPTIONS' }]);
    const orderId = await this.core.db.transaction(async (tx) => {
      const id = await this.insertOrder(tx, {
        userId,
        marketId: market.id,
        marketType: 'OPTIONS',
        clientOrderId: input.clientOrderId ?? newClientOrderId(),
        side: input.side,
        type: input.type,
        timeInForce: input.postOnly ? 'GTX' : (input.timeInForce ?? 'GTC'),
        triggerState: 'NONE',
        price: input.price ?? null,
        stopPrice: null,
        quantity: input.quantity,
        quoteQuantity: null,
        reduceOnly: input.reduceOnly,
        postOnly: input.postOnly,
        lockAssetId: settle,
        lockedAmount: q18(reserve).toFixed(18),
        source: ctx.source,
      });
      if (reserve.gt(0)) await this.lockMargin(tx, userId, settle, 'OPTIONS', reserve, id, new Map());
      return id;
    });
    return this.dispatch(orderId, market, false, ctx);
  }

  // ───────────────────────────── cancel / amend ─────────────────────────────

  async cancelOrder(userId: string, orderId: string, reason: 'USER' | 'ADMIN' = 'USER'): Promise<OrderRow> {
    const row = reason === 'ADMIN' ? await this.core.orders.find(orderId) : await this.core.orders.findForUser(userId, orderId);
    if (!row) throw new AppError('ORDER_NOT_FOUND', 'Order not found');
    if (!['NEW', 'OPEN', 'PARTIALLY_FILLED'].includes(row.status)) {
      throw new AppError('ORDER_NOT_CANCELLABLE', `Order is already ${row.status.toLowerCase()}`);
    }
    const res = await this.engine.submit({
      kind: 'CANCEL',
      orderId,
      marketId: Number(row.market_id),
      userId: reason === 'ADMIN' ? undefined : userId,
      reason,
    });
    if (res && !res.ok && res.error) throw new AppError(res.error.code, res.error.message);
    return (await this.core.orders.find(orderId))!;
  }

  async cancelAll(userId: string, symbol?: string, marketType?: MarketInfo['type']): Promise<string[]> {
    const markets = await this.core.db.query<{ market_id: number }>(
      `SELECT DISTINCT market_id FROM orders WHERE user_id = ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED')
         ${marketType ? 'AND market_type = ?' : ''}`,
      marketType ? [userId, marketType] : [userId],
    );
    const target = symbol ? this.core.markets.require(symbol).id : null;
    const cancelled: string[] = [];
    for (const { market_id } of markets) {
      if (target && Number(market_id) !== target) continue;
      const res = await this.engine.submit({ kind: 'CANCEL_ALL', marketId: Number(market_id), userId, reason: 'USER' });
      cancelled.push(...(res?.cancelled ?? []));
    }
    return cancelled;
  }

  async amendOrder(userId: string, orderId: string, input: { price?: string; quantity?: string }): Promise<OrderRow> {
    const row = await this.core.orders.findForUser(userId, orderId);
    if (!row) throw new AppError('ORDER_NOT_FOUND', 'Order not found');
    const res = await this.engine.submit({ kind: 'AMEND', orderId, marketId: Number(row.market_id), userId, ...input });
    if (res && !res.ok && res.error) throw new AppError(res.error.code, res.error.message);
    return (await this.core.orders.find(orderId))!;
  }
}
