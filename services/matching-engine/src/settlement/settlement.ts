import type { FillDto, MarketType, OrderStatus, PublicTradeDto } from '@gocrypto/shared-types';
import {
  type Core,
  FeeService,
  type MarketInfo,
  type OrderRow,
  type PositionState,
  type TradeStreamEntry,
  type Tx,
  applyFuturesFill,
  applyOptionFill,
  positionKey,
  walletKey,
} from '@gocrypto/server-core';
import { D, type Decimal, ZERO, dmax, dmin, q18, q18Up, shortOptionInitialMargin, toDb } from '@gocrypto/trading-utils';
import type { Fill, MatchResult } from '../engine/order-book';
import { BalanceSim } from './balance-sim';

export class AlreadyProcessedError extends Error {
  constructor(orderId: string, status: string) {
    super(`order ${orderId} already processed (status ${status})`);
  }
}

export class BookDesyncError extends Error {}

export interface OrderState {
  row: OrderRow;
  quantity: Decimal | null;
  filledQty: Decimal;
  filledQuote: Decimal;
  feeTotal: Decimal;
  feeAssetId: number | null;
  locked: Decimal;
  status: OrderStatus;
  engineSeq: string | null;
  rejectReason: string | null;
  changed: boolean;
  becameFinal: boolean;
  history: { event: string; details?: unknown }[];
}

const FINAL: OrderStatus[] = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'];

export function orderState(row: OrderRow): OrderState {
  return {
    row,
    quantity: row.quantity == null ? null : D(row.quantity),
    filledQty: D(row.filled_quantity),
    filledQuote: D(row.filled_quote),
    feeTotal: D(row.fee_total),
    feeAssetId: row.fee_asset_id == null ? null : Number(row.fee_asset_id),
    locked: D(row.locked_amount),
    status: row.status,
    engineSeq: row.engine_seq == null ? null : String(row.engine_seq),
    rejectReason: row.reject_reason,
    changed: false,
    becameFinal: false,
    history: [],
  };
}

function setStatus(o: OrderState, status: OrderStatus, event: string, details?: unknown): void {
  if (o.status !== status) {
    o.history.push({ event, details });
    if (FINAL.includes(status)) o.becameFinal = true;
  }
  o.status = status;
  o.changed = true;
}

export interface FillRecord {
  fill: Fill;
  tradeId?: string;
  takerFee: Decimal;
  takerFeeAssetId: number;
  makerFee: Decimal;
  makerFeeAssetId: number;
  takerPnl: Decimal | null;
  makerPnl: Decimal | null;
}

export interface SettleInput {
  market: MarketInfo;
  takerId: string;
  /** Effective quantity (resolved for closePosition orders). */
  takerQty: Decimal | null;
  result: MatchResult;
  indexPrice?: Decimal | null;
  optionMark?: Decimal | null;
  isLiquidation?: boolean;
  /** Amend re-match: the taker is already OPEN/PARTIALLY_FILLED. */
  takerOpen?: boolean;
}

export interface SettleOutput {
  orders: OrderState[];
  records: FillRecord[];
  positionsChanged: { userId: string; marketId: number; marketType: 'FUTURES' | 'OPTIONS' }[];
}

interface Ctx {
  tx: Tx;
  market: MarketInfo;
  states: Map<string, OrderState>;
  records: FillRecord[];
  positionsChanged: SettleOutput['positionsChanged'];
}

/**
 * Persists the outcome of one engine command atomically: trades, fills, order states, balance
 * ledger and positions. Any failure rolls the whole command back; the runner then reloads the
 * in-memory book from the database (the source of truth).
 */
export class Settlement {
  constructor(private readonly core: Core) {}

  private async feeRates(userIds: string[], market: MarketInfo) {
    const out = new Map<string, { maker: Decimal; taker: Decimal }>();
    for (const id of new Set(userIds)) {
      const flags = await this.core.users.flags(id);
      const r = await this.core.fees.ratesFor({ id, vipTier: flags.vipTier, isSystem: flags.isSystem }, market);
      // Maker rebates (negative rates) are not paid out in this version.
      out.set(id, { maker: dmax(ZERO, D(r.maker)), taker: dmax(ZERO, D(r.taker)) });
    }
    return out;
  }

  async settleMatch(input: SettleInput): Promise<SettleOutput> {
    const { market, result } = input;
    const makerIds = result.fills.map((f) => f.makerOrderId);
    const stpIds = result.expiredMakers.map((e) => e.orderId);
    const userIds = [
      ...new Set([...result.fills.flatMap((f) => [f.takerUserId, f.makerUserId]), ...result.expiredMakers.map((e) => e.userId)]),
    ];
    const rates = await this.feeRates(userIds, market);
    await this.ensureWallets(market, userIds);

    return this.core.db.transaction(async (tx) => {
      const rows = await this.core.orders.lockMany(tx, [input.takerId, ...makerIds, ...stpIds]);
      const takerRow = rows.get(input.takerId);
      if (!takerRow) throw new BookDesyncError(`taker ${input.takerId} not found`);
      const takerOk =
        takerRow.status === 'NEW' || (input.takerOpen && (takerRow.status === 'OPEN' || takerRow.status === 'PARTIALLY_FILLED'));
      if (!takerOk) throw new AlreadyProcessedError(input.takerId, takerRow.status);
      const states = new Map<string, OrderState>();
      const taker = orderState(takerRow);
      if (input.takerQty) taker.quantity = input.takerQty;
      states.set(taker.row.id, taker);
      for (const id of [...makerIds, ...stpIds]) {
        if (states.has(id)) continue;
        const r = rows.get(id);
        if (!r || (r.status !== 'OPEN' && r.status !== 'PARTIALLY_FILLED')) throw new BookDesyncError(`maker ${id} is not open in the database`);
        states.set(id, orderState(r));
      }
      const ctx: Ctx = { tx, market, states, records: [], positionsChanged: [] };

      if (market.type === 'SPOT') await this.spot(ctx, input, taker, rates);
      else if (market.type === 'FUTURES') await this.futures(ctx, input, taker, rates);
      else await this.options(ctx, input, taker, rates);

      await this.persist(ctx, input);
      return { orders: [...states.values()].filter((s) => s.changed), records: ctx.records, positionsChanged: ctx.positionsChanged };
    });
  }

  private async ensureWallets(market: MarketInfo, userIds: string[]): Promise<void> {
    const fee = this.core.users.systemIds.feeCollector;
    const ins = this.core.users.systemIds.insuranceFund;
    if (market.type === 'SPOT') {
      const keys = [...userIds, fee].flatMap((userId) => [
        { userId, assetId: market.baseAssetId, account: 'SPOT' as const },
        { userId, assetId: market.quoteAssetId, account: 'SPOT' as const },
      ]);
      await this.core.wallet.ensureWallets(this.core.db, keys);
    } else {
      const account = market.type === 'FUTURES' ? ('FUTURES' as const) : ('OPTIONS' as const);
      const assetId = market.quoteAssetId;
      await this.core.wallet.ensureWallets(
        this.core.db,
        [...userIds, fee, ins].map((userId) => ({ userId, assetId, account })),
      );
    }
  }

  // ─────────────────────────────── spot ───────────────────────────────

  private async spot(ctx: Ctx, input: SettleInput, taker: OrderState, rates: Map<string, { maker: Decimal; taker: Decimal }>) {
    const { market, result } = input;
    const sim = new BalanceSim(new Map());
    const base = market.baseAssetId;
    const quote = market.quoteAssetId;
    const feeAgg = new Map<number, Decimal>();
    const ref = (f: Fill) => ({ refType: 'TRADE', refId: `${market.id}:${f.seq}` });

    for (const f of result.fills) {
      const maker = ctx.states.get(f.makerOrderId)!;
      const buyer = f.takerSide === 'BUY' ? taker : maker;
      const seller = f.takerSide === 'BUY' ? maker : taker;
      const buyerRate = f.takerSide === 'BUY' ? rates.get(buyer.row.user_id)!.taker : rates.get(buyer.row.user_id)!.maker;
      const sellerRate = f.takerSide === 'SELL' ? rates.get(seller.row.user_id)!.taker : rates.get(seller.row.user_id)!.maker;
      const buyerFee = FeeService.tradingFee(f.quantity, buyerRate);
      const sellerFee = FeeService.tradingFee(f.quote, sellerRate);
      const b = buyer.row.user_id;
      const s = seller.row.user_id;
      sim.add(b, quote, 'SPOT', { locked: f.quote.neg() }, { type: 'TRADE_DEBIT', ...ref(f), idemKey: `t:${market.id}:${f.seq}:${buyer.row.id}:d` });
      sim.add(b, base, 'SPOT', { available: f.quantity.minus(buyerFee) }, { type: 'TRADE_CREDIT', ...ref(f), idemKey: `t:${market.id}:${f.seq}:${buyer.row.id}:c` });
      sim.add(s, base, 'SPOT', { locked: f.quantity.neg() }, { type: 'TRADE_DEBIT', ...ref(f), idemKey: `t:${market.id}:${f.seq}:${seller.row.id}:d` });
      sim.add(s, quote, 'SPOT', { available: f.quote.minus(sellerFee) }, { type: 'TRADE_CREDIT', ...ref(f), idemKey: `t:${market.id}:${f.seq}:${seller.row.id}:c` });
      feeAgg.set(base, (feeAgg.get(base) ?? ZERO).plus(buyerFee));
      feeAgg.set(quote, (feeAgg.get(quote) ?? ZERO).plus(sellerFee));
      buyer.locked = buyer.locked.minus(f.quote);
      seller.locked = seller.locked.minus(f.quantity);
      for (const [o, fee, feeAsset] of [
        [buyer, buyerFee, base],
        [seller, sellerFee, quote],
      ] as const) {
        o.filledQty = o.filledQty.plus(f.quantity);
        o.filledQuote = o.filledQuote.plus(f.quote);
        o.feeTotal = o.feeTotal.plus(fee);
        o.feeAssetId = feeAsset;
        o.changed = true;
      }
      ctx.records.push({
        fill: f,
        takerFee: f.takerSide === 'BUY' ? buyerFee : sellerFee,
        takerFeeAssetId: f.takerSide === 'BUY' ? base : quote,
        makerFee: f.takerSide === 'BUY' ? sellerFee : buyerFee,
        makerFeeAssetId: f.takerSide === 'BUY' ? quote : base,
        takerPnl: null,
        makerPnl: null,
      });
      setStatus(maker, f.makerDone ? 'FILLED' : 'PARTIALLY_FILLED', f.makerDone ? 'FILLED' : 'PARTIAL_FILL');
      if (f.makerDone) this.releaseRemaining(sim, maker, 'SPOT');
    }

    for (const e of result.expiredMakers) {
      const m = ctx.states.get(e.orderId)!;
      setStatus(m, 'EXPIRED', 'EXPIRED', { reason: 'SELF_TRADE_PREVENTION' });
      m.rejectReason = 'STP';
      this.releaseRemaining(sim, m, 'SPOT');
    }

    this.finalizeTaker(taker, result);
    if (FINAL.includes(taker.status)) {
      this.releaseRemaining(sim, taker, 'SPOT');
    } else if (taker.row.side === 'BUY' && taker.row.price) {
      // Resting buy: keep exactly price * remaining locked, release price improvement.
      const remaining = taker.quantity!.minus(taker.filledQty);
      const required = q18Up(remaining.mul(taker.row.price));
      const excess = taker.locked.minus(required);
      if (excess.gt(0)) {
        sim.release(taker.row.user_id, Number(taker.row.lock_asset_id), 'SPOT', excess, {
          type: 'ORDER_UNLOCK',
          refType: 'ORDER',
          refId: taker.row.id,
        });
        taker.locked = required;
      }
    }

    this.creditFees(sim, feeAgg, 'SPOT', market, result);
    await this.core.wallet.apply(ctx.tx, sim.changes);
  }

  // ─────────────────────────────── futures ───────────────────────────────

  private async futures(ctx: Ctx, input: SettleInput, taker: OrderState, rates: Map<string, { maker: Decimal; taker: Decimal }>) {
    const { market, result, tx } = { ...input, tx: ctx.tx };
    const settle = market.quoteAssetId;
    const feeUser = this.core.users.systemIds.feeCollector;
    const users = [...new Set([...ctx.states.values()].map((s) => String(s.row.user_id)))];
    const wallets = await this.core.wallet.lockWallets(tx, [...users, feeUser].map((userId) => ({ userId, assetId: settle, account: 'FUTURES' as const })));
    const positions = await this.core.futures.lockPositions(
      tx,
      [...ctx.states.values()].map((s) => ({
        userId: String(s.row.user_id),
        marketId: market.id,
        leverage: s.row.leverage ?? undefined,
        marginMode: s.row.margin_mode ?? undefined,
      })),
    );
    const sim = new BalanceSim(wallets);
    let feeTotal = ZERO;

    const applySide = (o: OrderState, f: Fill, isMaker: boolean): { fee: Decimal; pnl: Decimal } => {
      const userId = String(o.row.user_id);
      const pos = positions.get(positionKey(userId, market.id))!;
      const qty = f.quantity;
      const price = f.price;
      const meta = { refType: 'TRADE', refId: `${market.id}:${f.seq}` };
      const remainingBefore = (o.quantity ?? qty).minus(o.filledQty);
      const release = remainingBefore.lte(qty) ? o.locked : dmin(o.locked, q18(o.locked.mul(qty).div(remainingBefore)));
      sim.release(userId, settle, 'FUTURES', release, { type: 'ORDER_UNLOCK', ...meta });
      o.locked = o.locked.minus(release);
      const leverage = o.row.leverage ?? pos.leverage;
      if (!pos.side || pos.qty.isZero()) pos.marginMode = o.row.margin_mode ?? pos.marginMode;
      const side = o.row.side;
      const eff = applyFuturesFill(pos, side, qty, price, leverage);
      if (eff.marginReleased.gt(0)) sim.release(userId, settle, 'FUTURES', eff.marginReleased, { type: 'MARGIN_UNLOCK', ...meta });
      if (!eff.realizedPnl.isZero()) sim.add(userId, settle, 'FUTURES', { available: eff.realizedPnl }, { type: 'REALIZED_PNL', ...meta });
      const rate = isMaker ? rates.get(userId)!.maker : rates.get(userId)!.taker;
      const fee = FeeService.tradingFee(qty.mul(price), rate);
      if (eff.marginNeeded.gt(0)) {
        const avail = sim.available(userId, settle, 'FUTURES');
        const affordable = dmax(ZERO, dmin(eff.marginNeeded, avail.minus(fee)));
        sim.reserve(userId, settle, 'FUTURES', affordable, { type: 'MARGIN_LOCK', ...meta });
        pos.margin = pos.margin.plus(affordable);
      }
      if (fee.gt(0)) sim.add(userId, settle, 'FUTURES', { available: fee.neg() }, { type: 'FEE', ...meta });
      feeTotal = feeTotal.plus(fee);
      o.filledQty = o.filledQty.plus(qty);
      o.filledQuote = o.filledQuote.plus(f.quote);
      o.feeTotal = o.feeTotal.plus(fee);
      o.feeAssetId = settle;
      o.changed = true;
      if (!ctx.positionsChanged.some((p) => p.userId === userId)) {
        ctx.positionsChanged.push({ userId, marketId: market.id, marketType: 'FUTURES' });
      }
      return { fee, pnl: eff.realizedPnl };
    };

    for (const f of result.fills) {
      const maker = ctx.states.get(f.makerOrderId)!;
      const t = applySide(taker, f, false);
      const m = applySide(maker, f, true);
      ctx.records.push({
        fill: f,
        takerFee: t.fee,
        takerFeeAssetId: settle,
        makerFee: m.fee,
        makerFeeAssetId: settle,
        takerPnl: t.pnl,
        makerPnl: m.pnl,
      });
      setStatus(maker, f.makerDone ? 'FILLED' : 'PARTIALLY_FILLED', f.makerDone ? 'FILLED' : 'PARTIAL_FILL');
      if (f.makerDone) this.releaseRemaining(sim, maker, 'FUTURES');
    }
    for (const e of result.expiredMakers) {
      const m = ctx.states.get(e.orderId)!;
      setStatus(m, 'EXPIRED', 'EXPIRED', { reason: 'SELF_TRADE_PREVENTION' });
      m.rejectReason = 'STP';
      this.releaseRemaining(sim, m, 'FUTURES');
    }
    this.finalizeTaker(taker, result);
    if (FINAL.includes(taker.status)) this.releaseRemaining(sim, taker, 'FUTURES');

    if (feeTotal.gt(0)) {
      sim.add(feeUser, settle, 'FUTURES', { available: feeTotal }, { type: 'FEE_REVENUE', refType: 'TRADES', refId: this.tradeRange(market, result) });
    }
    await this.coverDeficits(tx, sim, wallets, users, settle, 'FUTURES', market, result);
    await this.core.wallet.apply(tx, sim.changes, wallets);
    await this.core.futures.savePositions(tx, positions.values());
  }

  // ─────────────────────────────── options ───────────────────────────────

  private async options(ctx: Ctx, input: SettleInput, taker: OrderState, rates: Map<string, { maker: Decimal; taker: Decimal }>) {
    const { market, result } = input;
    const tx = ctx.tx;
    const settle = market.quoteAssetId;
    const feeUser = this.core.users.systemIds.feeCollector;
    const users = [...new Set([...ctx.states.values()].map((s) => String(s.row.user_id)))];
    const wallets = await this.core.wallet.lockWallets(tx, [...users, feeUser].map((userId) => ({ userId, assetId: settle, account: 'OPTIONS' as const })));
    const positions = await this.core.options.lockPositions(
      tx,
      users.map((userId) => ({ userId, marketId: market.id })),
    );
    const sim = new BalanceSim(wallets);
    const index = input.indexPrice ?? D(market.option!.strike);
    const mark = input.optionMark ?? ZERO;
    let feeTotal = ZERO;

    const applySide = (o: OrderState, f: Fill, isMaker: boolean): { fee: Decimal; pnl: Decimal } => {
      const userId = String(o.row.user_id);
      const pos = positions.get(`${userId}:${market.id}`)!;
      const meta = { refType: 'TRADE', refId: `${market.id}:${f.seq}` };
      const remainingBefore = (o.quantity ?? f.quantity).minus(o.filledQty);
      const release = remainingBefore.lte(f.quantity) ? o.locked : dmin(o.locked, q18(o.locked.mul(f.quantity).div(remainingBefore)));
      sim.release(userId, settle, 'OPTIONS', release, { type: 'ORDER_UNLOCK', ...meta });
      o.locked = o.locked.minus(release);
      const rate = isMaker ? rates.get(userId)!.maker : rates.get(userId)!.taker;
      const fee = FeeService.optionFee(rate, index, f.price, f.quantity);
      const premium = f.quote;
      const eff = applyOptionFill(pos, o.row.side, f.quantity, f.price);
      if (o.row.side === 'BUY') {
        sim.add(userId, settle, 'OPTIONS', { available: premium.neg() }, { type: 'OPTION_PREMIUM', ...meta });
        if (eff.marginReleased.gt(0)) sim.release(userId, settle, 'OPTIONS', eff.marginReleased, { type: 'MARGIN_UNLOCK', ...meta });
      } else {
        sim.add(userId, settle, 'OPTIONS', { available: premium }, { type: 'OPTION_PREMIUM', ...meta });
        if (eff.opensShort && eff.openedQty.gt(0)) {
          const needed = shortOptionInitialMargin({
            type: market.option!.optionType,
            indexPrice: index,
            strike: market.option!.strike,
            markPrice: dmax(mark, f.price),
            qty: eff.openedQty,
          });
          const affordable = dmax(ZERO, dmin(needed, sim.available(userId, settle, 'OPTIONS').minus(fee)));
          sim.reserve(userId, settle, 'OPTIONS', affordable, { type: 'MARGIN_LOCK', ...meta });
          pos.margin = pos.margin.plus(affordable);
        }
      }
      if (fee.gt(0)) sim.add(userId, settle, 'OPTIONS', { available: fee.neg() }, { type: 'FEE', ...meta });
      feeTotal = feeTotal.plus(fee);
      o.filledQty = o.filledQty.plus(f.quantity);
      o.filledQuote = o.filledQuote.plus(premium);
      o.feeTotal = o.feeTotal.plus(fee);
      o.feeAssetId = settle;
      o.changed = true;
      if (!ctx.positionsChanged.some((p) => p.userId === userId)) {
        ctx.positionsChanged.push({ userId, marketId: market.id, marketType: 'OPTIONS' });
      }
      return { fee, pnl: eff.realizedPnl };
    };

    for (const f of result.fills) {
      const maker = ctx.states.get(f.makerOrderId)!;
      const t = applySide(taker, f, false);
      const m = applySide(maker, f, true);
      ctx.records.push({ fill: f, takerFee: t.fee, takerFeeAssetId: settle, makerFee: m.fee, makerFeeAssetId: settle, takerPnl: t.pnl, makerPnl: m.pnl });
      setStatus(maker, f.makerDone ? 'FILLED' : 'PARTIALLY_FILLED', f.makerDone ? 'FILLED' : 'PARTIAL_FILL');
      if (f.makerDone) this.releaseRemaining(sim, maker, 'OPTIONS');
    }
    for (const e of result.expiredMakers) {
      const m = ctx.states.get(e.orderId)!;
      setStatus(m, 'EXPIRED', 'EXPIRED', { reason: 'SELF_TRADE_PREVENTION' });
      m.rejectReason = 'STP';
      this.releaseRemaining(sim, m, 'OPTIONS');
    }
    this.finalizeTaker(taker, result);
    if (FINAL.includes(taker.status)) this.releaseRemaining(sim, taker, 'OPTIONS');
    if (feeTotal.gt(0)) {
      sim.add(feeUser, settle, 'OPTIONS', { available: feeTotal }, { type: 'FEE_REVENUE', refType: 'TRADES', refId: this.tradeRange(market, result) });
    }
    await this.coverDeficits(tx, sim, wallets, users, settle, 'OPTIONS', market, result);
    await this.core.wallet.apply(tx, sim.changes, wallets);
    await this.core.options.savePositions(tx, positions.values());
  }

  // ─────────────────────────────── shared helpers ───────────────────────────────

  private tradeRange(market: MarketInfo, result: MatchResult): string {
    const first = result.fills[0]?.seq ?? 0;
    const last = result.fills[result.fills.length - 1]?.seq ?? 0;
    return `${market.id}:${first}-${last}`;
  }

  /** Bankruptcy protection: any negative available balance is covered by the insurance fund. */
  private async coverDeficits(
    tx: Tx,
    sim: BalanceSim,
    wallets: Map<string, import('@gocrypto/server-core').WalletRow>,
    users: string[],
    assetId: number,
    account: 'FUTURES' | 'OPTIONS',
    market: MarketInfo,
    result: MatchResult,
  ): Promise<void> {
    const ins = this.core.users.systemIds.insuranceFund;
    let total = ZERO;
    for (const userId of users) {
      if (userId === ins) continue;
      const avail = sim.available(userId, assetId, account);
      if (avail.isNegative()) {
        const deficit = avail.neg();
        sim.add(userId, assetId, account, { available: deficit }, { type: 'INSURANCE_FUND', refType: 'BANKRUPTCY', refId: this.tradeRange(market, result) });
        total = total.plus(deficit);
        this.core.log.warn({ userId, deficit: deficit.toFixed(), market: market.symbol }, 'insurance fund covered trading deficit');
      }
    }
    if (total.gt(0)) {
      const insKey = walletKey({ userId: ins, assetId, account });
      if (!wallets.has(insKey)) {
        await this.core.wallet.lockWallets(tx, [{ userId: ins, assetId, account }], wallets);
      }
      sim.add(ins, assetId, account, { available: total.neg() }, { type: 'INSURANCE_FUND', refType: 'BANKRUPTCY', refId: this.tradeRange(market, result) });
    }
  }

  private finalizeTaker(taker: OrderState, result: MatchResult): void {
    if (result.outcome === 'REJECTED') {
      const expire = result.rejectReason === 'POST_ONLY_WOULD_TAKE' || result.rejectReason === 'FOK_NOT_FILLABLE';
      setStatus(taker, expire ? 'EXPIRED' : 'REJECTED', expire ? 'EXPIRED' : 'REJECTED', { reason: result.rejectReason });
      taker.rejectReason = result.rejectReason ?? 'REJECTED';
      return;
    }
    if (result.outcome === 'FILLED') {
      setStatus(taker, 'FILLED', 'FILLED');
      return;
    }
    if (result.outcome === 'RESTING') {
      setStatus(taker, taker.filledQty.gt(0) ? 'PARTIALLY_FILLED' : 'OPEN', taker.filledQty.gt(0) ? 'PARTIAL_FILL' : 'ACCEPTED');
      taker.engineSeq = String(result.rested!.seq);
      return;
    }
    setStatus(taker, 'EXPIRED', 'EXPIRED', { reason: result.rejectReason ?? result.stopReason });
    taker.rejectReason = result.rejectReason ?? (result.stopReason && result.stopReason !== 'FILLED' ? result.stopReason : null);
  }

  /** Release whatever is still reserved for an order (it is final or fully consumed). */
  private releaseRemaining(sim: BalanceSim, o: OrderState, account: 'SPOT' | 'FUTURES' | 'OPTIONS'): void {
    if (o.locked.lte(0) || o.row.lock_asset_id == null) {
      o.locked = dmax(ZERO, o.locked);
      return;
    }
    sim.release(String(o.row.user_id), Number(o.row.lock_asset_id), account, o.locked, {
      type: 'ORDER_UNLOCK',
      refType: 'ORDER',
      refId: o.row.id,
    });
    o.locked = ZERO;
    o.changed = true;
  }

  private creditFees(sim: BalanceSim, feeAgg: Map<number, Decimal>, account: 'SPOT', market: MarketInfo, result: MatchResult): void {
    const feeUser = this.core.users.systemIds.feeCollector;
    for (const [assetId, amount] of feeAgg) {
      if (amount.gt(0)) {
        sim.add(feeUser, assetId, account, { available: amount }, { type: 'FEE_REVENUE', refType: 'TRADES', refId: this.tradeRange(market, result) });
      }
    }
  }

  private async persist(ctx: Ctx, input: SettleInput): Promise<void> {
    const { tx, market } = ctx;
    const fills = input.result.fills;
    if (fills.length) {
      await tx.execute(
        `INSERT INTO trades (market_id, seq, price, quantity, quote_quantity, taker_side, maker_order_id, taker_order_id,
           maker_user_id, taker_user_id, maker_fee, taker_fee, is_liquidation)
         VALUES ${fills.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        ctx.records.flatMap((r) => [
          market.id,
          r.fill.seq,
          toDb(r.fill.price),
          toDb(r.fill.quantity),
          toDb(r.fill.quote),
          r.fill.takerSide,
          r.fill.makerOrderId,
          r.fill.takerOrderId,
          r.fill.makerUserId,
          r.fill.takerUserId,
          toDb(r.makerFee),
          toDb(r.takerFee),
          input.isLiquidation ? 1 : 0,
        ]),
      );
      const ids = await tx.query<{ id: string; seq: string }>(
        `SELECT id, seq FROM trades WHERE market_id = ? AND seq IN (${fills.map(() => '?').join(', ')})`,
        [market.id, ...fills.map((f) => f.seq)],
      );
      const bySeq = new Map(ids.map((r) => [Number(r.seq), String(r.id)]));
      for (const r of ctx.records) r.tradeId = bySeq.get(r.fill.seq);
      const fillRows: unknown[][] = [];
      for (const r of ctx.records) {
        const makerSide = r.fill.takerSide === 'BUY' ? 'SELL' : 'BUY';
        fillRows.push([
          r.fill.takerOrderId, r.tradeId, r.fill.takerUserId, market.id, market.type, r.fill.takerSide, 0,
          toDb(r.fill.price), toDb(r.fill.quantity), toDb(r.fill.quote), toDb(r.takerFee), r.takerFeeAssetId,
          r.takerPnl === null ? null : toDb(r.takerPnl),
        ]);
        fillRows.push([
          r.fill.makerOrderId, r.tradeId, r.fill.makerUserId, market.id, market.type, makerSide, 1,
          toDb(r.fill.price), toDb(r.fill.quantity), toDb(r.fill.quote), toDb(r.makerFee), r.makerFeeAssetId,
          r.makerPnl === null ? null : toDb(r.makerPnl),
        ]);
      }
      await tx.execute(
        `INSERT INTO order_fills (order_id, trade_id, user_id, market_id, market_type, side, is_maker, price, quantity,
           quote_quantity, fee, fee_asset_id, realized_pnl)
         VALUES ${fillRows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        fillRows.flat(),
      );
    }
    const history: { orderId: string; userId: string; event: string; status: OrderStatus; details?: unknown }[] = [];
    for (const o of ctx.states.values()) {
      if (!o.changed) continue;
      await this.saveOrder(tx, o);
      for (const h of o.history) history.push({ orderId: o.row.id, userId: String(o.row.user_id), event: h.event, status: o.status, details: h.details });
    }
    await this.core.orders.addHistory(tx, history);
  }

  async saveOrder(tx: Tx, o: OrderState): Promise<void> {
    await tx.execute(
      `UPDATE orders SET status = ?, filled_quantity = ?, filled_quote = ?, fee_total = ?, fee_asset_id = ?, locked_amount = ?,
         engine_seq = ?, quantity = ?, reject_reason = ?, done_at = ?
       WHERE id = ?`,
      [
        o.status,
        toDb(o.filledQty),
        toDb(o.filledQuote),
        toDb(o.feeTotal),
        o.feeAssetId,
        toDb(dmax(ZERO, o.locked)),
        o.engineSeq,
        o.quantity ? toDb(o.quantity) : null,
        o.rejectReason,
        FINAL.includes(o.status) ? new Date() : null,
        o.row.id,
      ],
    );
  }

  /**
   * Cancel orders (already removed from the in-memory book): mark CANCELLED and release funds.
   * Orders that are no longer open are skipped (idempotent).
   */
  async cancelOrders(
    orderIds: string[],
    reason: string,
    opts: { status?: OrderStatus; onlyPendingTrigger?: boolean } = {},
  ): Promise<OrderState[]> {
    if (!orderIds.length) return [];
    return this.core.db.transaction(async (tx) => {
      const rows = await this.core.orders.lockMany(tx, orderIds);
      const sim = new BalanceSim(new Map());
      const changed: OrderState[] = [];
      for (const row of rows.values()) {
        if (!['NEW', 'OPEN', 'PARTIALLY_FILLED'].includes(row.status)) continue;
        if (opts.onlyPendingTrigger && row.trigger_state !== 'PENDING') continue;
        const o = orderState(row);
        setStatus(o, opts.status ?? 'CANCELLED', opts.status ?? 'CANCELLED', { reason });
        o.rejectReason = reason;
        this.releaseRemaining(sim, o, row.market_type);
        await this.saveOrder(tx, o);
        changed.push(o);
      }
      await this.core.orders.addHistory(
        tx,
        changed.map((o) => ({ orderId: o.row.id, userId: String(o.row.user_id), event: o.status, status: o.status, details: { reason } })),
      );
      if (sim.changes.length) await this.core.wallet.apply(tx, sim.changes);
      return changed;
    });
  }

  /** Reject a NEW order that never reached the book and release its reserved funds. */
  async rejectOrder(orderId: string, reason: string, status: OrderStatus = 'REJECTED'): Promise<OrderState | null> {
    return this.core.db.transaction(async (tx) => {
      const row = await this.core.orders.lock(tx, orderId);
      if (!row || row.status !== 'NEW') return null;
      const o = orderState(row);
      setStatus(o, status, status, { reason });
      o.rejectReason = reason;
      const sim = new BalanceSim(new Map());
      this.releaseRemaining(sim, o, row.market_type);
      await this.saveOrder(tx, o);
      await this.core.orders.addHistory(tx, [{ orderId, userId: String(row.user_id), event: status, status, details: { reason } }]);
      if (sim.changes.length) await this.core.wallet.apply(tx, sim.changes);
      return o;
    });
  }

  static fillDtos(core: Core, market: MarketInfo, records: FillRecord[]): { user: string; dto: FillDto }[] {
    const out: { user: string; dto: FillDto }[] = [];
    const now = Date.now();
    for (const r of records) {
      const makerSide = r.fill.takerSide === 'BUY' ? 'SELL' : 'BUY';
      const common = {
        tradeId: r.tradeId ?? '',
        symbol: market.symbol,
        marketType: market.type as MarketType,
        price: r.fill.price.toFixed(),
        qty: r.fill.quantity.toFixed(),
        quoteQty: r.fill.quote.toFixed(),
        ts: now,
      };
      out.push({
        user: r.fill.takerUserId,
        dto: {
          ...common,
          id: `${r.tradeId}-t`,
          orderId: r.fill.takerOrderId,
          side: r.fill.takerSide,
          isMaker: false,
          fee: r.takerFee.toFixed(),
          feeAsset: core.assets.symbolOf(r.takerFeeAssetId),
          realizedPnl: r.takerPnl ? r.takerPnl.toFixed() : null,
        },
      });
      out.push({
        user: r.fill.makerUserId,
        dto: {
          ...common,
          id: `${r.tradeId}-m`,
          orderId: r.fill.makerOrderId,
          side: makerSide,
          isMaker: true,
          fee: r.makerFee.toFixed(),
          feeAsset: core.assets.symbolOf(r.makerFeeAssetId),
          realizedPnl: r.makerPnl ? r.makerPnl.toFixed() : null,
        },
      });
    }
    return out;
  }

  static publicTrades(market: MarketInfo, records: FillRecord[]): { trades: PublicTradeDto[]; stream: TradeStreamEntry[] } {
    const now = Date.now();
    const trades: PublicTradeDto[] = records.map((r) => ({
      id: r.tradeId ?? String(r.fill.seq),
      symbol: market.symbol,
      price: r.fill.price.toFixed(),
      qty: r.fill.quantity.toFixed(),
      quoteQty: r.fill.quote.toFixed(),
      side: r.fill.takerSide,
      ts: now,
    }));
    const stream: TradeStreamEntry[] = records.map((r) => ({
      marketId: market.id,
      symbol: market.symbol,
      marketType: market.type,
      seq: r.fill.seq,
      tradeId: r.tradeId ?? '',
      price: r.fill.price.toFixed(),
      qty: r.fill.quantity.toFixed(),
      quoteQty: r.fill.quote.toFixed(),
      takerSide: r.fill.takerSide,
      ts: now,
    }));
    return { trades, stream };
  }
}

export type { PositionState };
