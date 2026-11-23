import type { FuturesAccountDto, FuturesPositionDto, MarginMode, OrderSide, PositionSide } from '@gocrypto/shared-types';
import {
  D,
  type Decimal,
  ZERO,
  averageEntryPrice,
  bankruptcyPrice,
  dmax,
  dmin,
  initialMargin,
  liquidationPrice,
  maintenanceMargin,
  notional,
  q18,
  roe,
  toPlain,
  unrealizedPnl,
} from '@gocrypto/trading-utils';
import type { MarketInfo } from '../cache/markets';
import type { Core } from '../core';
import { type Executor, type Tx, placeholders, toMsStrict } from '../db/database';
import { AppError } from '../errors';

export interface PositionRow {
  id: string;
  user_id: string;
  market_id: number;
  side: PositionSide | null;
  quantity: string;
  entry_price: string;
  leverage: number;
  margin_mode: MarginMode;
  margin: string;
  realized_pnl: string;
  funding_fees: string;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  version: string;
  opened_at: Date | null;
  closed_at: Date | null;
  updated_at: Date;
}

/** Mutable in-memory position used while a settlement transaction holds the row lock. */
export interface PositionState {
  id: string;
  userId: string;
  marketId: number;
  side: PositionSide | null;
  qty: Decimal;
  entry: Decimal;
  leverage: number;
  marginMode: MarginMode;
  margin: Decimal;
  realizedPnl: Decimal;
  fundingFees: Decimal;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  version: number;
  openedAt: Date | null;
  closedAt: Date | null;
  dirty: boolean;
}

export function positionKey(userId: string, marketId: number): string {
  return `${userId}:${marketId}`;
}

export function toPositionState(r: PositionRow): PositionState {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    marketId: Number(r.market_id),
    side: r.side,
    qty: D(r.quantity),
    entry: D(r.entry_price),
    leverage: Number(r.leverage),
    marginMode: r.margin_mode,
    margin: D(r.margin),
    realizedPnl: D(r.realized_pnl),
    fundingFees: D(r.funding_fees),
    status: r.status,
    version: Number(r.version),
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    dirty: false,
  };
}

export interface FillEffect {
  closedQty: Decimal;
  openedQty: Decimal;
  realizedPnl: Decimal;
  /** Margin removed from the position because of the closed quantity (to be unlocked). */
  marginReleased: Decimal;
  /** Initial margin the opened quantity requires at the fill price. */
  marginNeeded: Decimal;
}

/**
 * Apply a fill to a one-way position. Mutates `pos` (side, qty, entry, margin for closes,
 * realized PnL). The caller locks `marginNeeded` (or what is affordable) and adds it to pos.margin.
 */
export function applyFuturesFill(pos: PositionState, side: OrderSide, qty: Decimal, price: Decimal, leverage: number): FillEffect {
  const dir: PositionSide = side === 'BUY' ? 'LONG' : 'SHORT';
  const effect: FillEffect = { closedQty: ZERO, openedQty: ZERO, realizedPnl: ZERO, marginReleased: ZERO, marginNeeded: ZERO };
  let remaining = qty;
  pos.dirty = true;

  if (pos.side && pos.qty.gt(0) && pos.side !== dir) {
    const close = dmin(pos.qty, remaining);
    const pnl = price.minus(pos.entry).mul(close).mul(pos.side === 'LONG' ? 1 : -1);
    const released = close.eq(pos.qty) ? pos.margin : q18(pos.margin.mul(close).div(pos.qty));
    pos.qty = pos.qty.minus(close);
    pos.margin = pos.margin.minus(released);
    pos.realizedPnl = pos.realizedPnl.plus(pnl);
    effect.closedQty = close;
    effect.realizedPnl = q18(pnl);
    effect.marginReleased = released;
    remaining = remaining.minus(close);
    if (pos.qty.isZero()) {
      pos.side = null;
      pos.entry = ZERO;
      pos.margin = ZERO;
      pos.status = 'CLOSED';
      pos.closedAt = new Date();
    }
  }

  if (remaining.gt(0)) {
    if (!pos.side || pos.qty.isZero()) {
      pos.side = dir;
      pos.entry = price;
      pos.qty = remaining;
      pos.status = 'OPEN';
      pos.openedAt = new Date();
      pos.closedAt = null;
      pos.realizedPnl = effect.closedQty.gt(0) ? pos.realizedPnl : ZERO;
      pos.fundingFees = ZERO;
      pos.leverage = leverage;
    } else {
      pos.entry = averageEntryPrice(pos.qty, pos.entry, remaining, price);
      pos.qty = pos.qty.plus(remaining);
    }
    effect.openedQty = remaining;
    effect.marginNeeded = initialMargin(notional(remaining, price), pos.leverage);
  }
  return effect;
}

/** Initial margin for a quantity at a price and leverage. */
export function initialMarginFor(qty: Decimal, price: Decimal, leverage: number): Decimal {
  return initialMargin(notional(qty, price), leverage);
}

export interface PositionMetrics {
  markPrice: Decimal;
  notional: Decimal;
  unrealizedPnl: Decimal;
  maintenanceMargin: Decimal;
  initialMargin: Decimal;
}

export function positionMetrics(pos: Pick<PositionState, 'side' | 'qty' | 'entry' | 'leverage'>, market: MarketInfo, mark: Decimal): PositionMetrics {
  if (!pos.side || pos.qty.isZero()) {
    return { markPrice: mark, notional: ZERO, unrealizedPnl: ZERO, maintenanceMargin: ZERO, initialMargin: ZERO };
  }
  const tiers = market.futures?.riskTiers ?? [];
  return {
    markPrice: mark,
    notional: notional(pos.qty, mark),
    unrealizedPnl: unrealizedPnl(pos.side, pos.qty, pos.entry, mark),
    maintenanceMargin: tiers.length ? maintenanceMargin(tiers, pos.qty, mark) : ZERO,
    initialMargin: initialMargin(notional(pos.qty, pos.entry), pos.leverage),
  };
}

export interface CrossAccountState {
  walletBalance: Decimal;
  available: Decimal;
  locked: Decimal;
  isolatedMargin: Decimal;
  orderMargin: Decimal;
  crossUnrealizedPnl: Decimal;
  crossMaintenance: Decimal;
  totalUnrealizedPnl: Decimal;
  totalMaintenance: Decimal;
  positionMargin: Decimal;
}

/** Aggregate account risk numbers from wallet + positions + mark prices (pure). */
export function evaluateAccount(
  wallet: { available: Decimal; locked: Decimal },
  positions: { pos: PositionState; market: MarketInfo; mark: Decimal }[],
  orderMargin: Decimal,
): CrossAccountState & { perPosition: Map<string, PositionMetrics> } {
  const perPosition = new Map<string, PositionMetrics>();
  let isolatedMargin = ZERO;
  let crossUpnl = ZERO;
  let crossMm = ZERO;
  let totalUpnl = ZERO;
  let totalMm = ZERO;
  let positionMargin = ZERO;
  for (const { pos, market, mark } of positions) {
    if (!pos.side || pos.qty.isZero()) continue;
    const m = positionMetrics(pos, market, mark);
    perPosition.set(pos.id, m);
    totalUpnl = totalUpnl.plus(m.unrealizedPnl);
    totalMm = totalMm.plus(m.maintenanceMargin);
    positionMargin = positionMargin.plus(pos.margin);
    if (pos.marginMode === 'ISOLATED') isolatedMargin = isolatedMargin.plus(pos.margin);
    else {
      crossUpnl = crossUpnl.plus(m.unrealizedPnl);
      crossMm = crossMm.plus(m.maintenanceMargin);
    }
  }
  return {
    walletBalance: wallet.available.plus(wallet.locked),
    available: wallet.available,
    locked: wallet.locked,
    isolatedMargin,
    orderMargin,
    crossUnrealizedPnl: crossUpnl,
    crossMaintenance: crossMm,
    totalUnrealizedPnl: totalUpnl,
    totalMaintenance: totalMm,
    positionMargin,
    perPosition,
  };
}

/** Margin backing a position for liquidation-price purposes. */
export function effectiveMargin(pos: PositionState, account: ReturnType<typeof evaluateAccount>): Decimal {
  if (pos.marginMode === 'ISOLATED') return pos.margin;
  const m = account.perPosition.get(pos.id);
  if (!m) return ZERO;
  const crossWallet = account.walletBalance.minus(account.isolatedMargin);
  const othersUpnl = account.crossUnrealizedPnl.minus(m.unrealizedPnl);
  const othersMm = account.crossMaintenance.minus(m.maintenanceMargin);
  return crossWallet.plus(othersUpnl).minus(othersMm);
}

export type LiquidationVerdict = { liquidate: false } | { liquidate: true; mode: MarginMode; positionIds: string[] };

/**
 * Liquidation rule:
 *  - isolated position: margin + uPnL <= maintenance margin
 *  - cross account: (wallet - isolated margins + cross uPnL) <= cross maintenance margin
 *    (all cross positions are liquidated together)
 */
export function liquidationCheck(positions: PositionState[], account: ReturnType<typeof evaluateAccount>): LiquidationVerdict[] {
  const verdicts: LiquidationVerdict[] = [];
  for (const pos of positions) {
    if (pos.marginMode !== 'ISOLATED' || !pos.side || pos.qty.isZero()) continue;
    const m = account.perPosition.get(pos.id);
    if (m && pos.margin.plus(m.unrealizedPnl).lte(m.maintenanceMargin)) {
      verdicts.push({ liquidate: true, mode: 'ISOLATED', positionIds: [pos.id] });
    }
  }
  const cross = positions.filter((p) => p.marginMode === 'CROSS' && p.side && p.qty.gt(0));
  if (cross.length) {
    const crossBalance = account.walletBalance.minus(account.isolatedMargin).plus(account.crossUnrealizedPnl);
    if (crossBalance.lte(account.crossMaintenance)) {
      verdicts.push({ liquidate: true, mode: 'CROSS', positionIds: cross.map((p) => p.id) });
    }
  }
  return verdicts;
}

export class FuturesService {
  constructor(private readonly core: Core) {}

  settleAssetId(market: MarketInfo): number {
    return market.futures?.settleAssetId ?? market.quoteAssetId;
  }

  /** Leverage / margin mode for a user and contract (defaults from the contract). */
  async settings(userId: string, market: MarketInfo, exec: Executor = this.core.db): Promise<{ leverage: number; marginMode: MarginMode }> {
    const row = await exec.one<{ leverage: number; margin_mode: MarginMode }>(
      'SELECT leverage, margin_mode FROM futures_user_settings WHERE user_id = ? AND market_id = ?',
      [userId, market.id],
    );
    return {
      leverage: row ? Number(row.leverage) : (market.futures?.defaultLeverage ?? 20),
      marginMode: row?.margin_mode ?? 'CROSS',
    };
  }

  async saveSettings(exec: Executor, userId: string, marketId: number, leverage: number, marginMode: MarginMode): Promise<void> {
    await exec.execute(
      `INSERT INTO futures_user_settings (user_id, market_id, leverage, margin_mode) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE leverage = VALUES(leverage), margin_mode = VALUES(margin_mode)`,
      [userId, marketId, leverage, marginMode],
    );
  }

  /** Lock position rows (creating flat rows when missing) in deterministic order. */
  async lockPositions(
    tx: Tx,
    keys: { userId: string; marketId: number; leverage?: number; marginMode?: MarginMode }[],
    into = new Map<string, PositionState>(),
  ): Promise<Map<string, PositionState>> {
    const uniq = [...new Map(keys.map((k) => [positionKey(k.userId, k.marketId), k])).values()]
      .filter((k) => !into.has(positionKey(k.userId, k.marketId)))
      .sort((a, b) => (a.userId === b.userId ? a.marketId - b.marketId : BigInt(a.userId) < BigInt(b.userId) ? -1 : 1));
    if (!uniq.length) return into;
    const select = (ks: typeof uniq) =>
      tx.query<PositionRow>(
        `SELECT * FROM futures_positions WHERE (user_id, market_id) IN (${ks.map(() => '(?, ?)').join(', ')})
          ORDER BY user_id, market_id FOR UPDATE`,
        ks.flatMap((k) => [k.userId, k.marketId]),
      );
    for (const r of await select(uniq)) into.set(positionKey(String(r.user_id), Number(r.market_id)), toPositionState(r));
    const missing = uniq.filter((k) => !into.has(positionKey(k.userId, k.marketId)));
    if (missing.length) {
      for (const k of missing) {
        const market = this.core.markets.requireId(k.marketId);
        await tx.execute(
          `INSERT IGNORE INTO futures_positions (user_id, market_id, leverage, margin_mode) VALUES (?, ?, ?, ?)`,
          [k.userId, k.marketId, k.leverage ?? market.futures?.defaultLeverage ?? 20, k.marginMode ?? 'CROSS'],
        );
      }
      for (const r of await select(missing)) into.set(positionKey(String(r.user_id), Number(r.market_id)), toPositionState(r));
    }
    return into;
  }

  async savePositions(tx: Tx, states: Iterable<PositionState>): Promise<PositionState[]> {
    const saved: PositionState[] = [];
    for (const p of states) {
      if (!p.dirty) continue;
      const res = await tx.execute(
        `UPDATE futures_positions SET side = ?, quantity = ?, entry_price = ?, leverage = ?, margin_mode = ?, margin = ?,
           realized_pnl = ?, funding_fees = ?, status = ?, opened_at = ?, closed_at = ?, version = version + 1
         WHERE id = ? AND version = ?`,
        [
          p.side,
          q18(p.qty).toFixed(18),
          q18(p.entry).toFixed(18),
          p.leverage,
          p.marginMode,
          q18(p.margin).toFixed(18),
          q18(p.realizedPnl).toFixed(18),
          q18(p.fundingFees).toFixed(18),
          p.status,
          p.openedAt,
          p.closedAt,
          p.id,
          p.version,
        ],
      );
      if (res.affectedRows !== 1) throw new Error(`position ${p.id} version conflict`);
      p.version += 1;
      p.dirty = false;
      saved.push(p);
    }
    return saved;
  }

  async positionsOf(userId: string, exec: Executor = this.core.db, onlyOpen = true): Promise<PositionState[]> {
    const rows = await exec.query<PositionRow>(
      `SELECT * FROM futures_positions WHERE user_id = ? ${onlyOpen ? "AND status = 'OPEN' AND quantity > 0" : ''}`,
      [userId],
    );
    return rows.map(toPositionState);
  }

  async orderMargin(userId: string, exec: Executor = this.core.db): Promise<Decimal> {
    const r = await exec.one<{ s: string | null }>(
      "SELECT SUM(locked_amount) AS s FROM orders WHERE user_id = ? AND market_type = 'FUTURES' AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
      [userId],
    );
    return D(r?.s ?? 0);
  }

  async markPrices(markets: MarketInfo[]): Promise<Map<number, Decimal>> {
    const out = new Map<number, Decimal>();
    await Promise.all(
      markets.map(async (m) => {
        const mp = await this.core.prices.markPrice(m.symbol);
        const price = mp?.markPrice ?? (await this.core.prices.lastPrice(m.symbol));
        if (price) out.set(m.id, D(price));
      }),
    );
    return out;
  }

  /** Full account evaluation for a user (read model). */
  async evaluate(userId: string, exec: Executor = this.core.db) {
    const usdt = this.core.assets.require('USDT');
    const wallet = (await this.core.wallet.getWallet(exec, { userId, assetId: usdt.id, account: 'FUTURES' })) ?? {
      available: ZERO,
      locked: ZERO,
    };
    const positions = await this.positionsOf(userId, exec);
    const markets = positions.map((p) => this.core.markets.requireId(p.marketId));
    const marks = await this.markPrices(markets);
    const orderMargin = await this.orderMargin(userId, exec);
    const items = positions.map((pos) => {
      const market = this.core.markets.requireId(pos.marketId);
      return { pos, market, mark: marks.get(pos.marketId) ?? pos.entry };
    });
    const account = evaluateAccount({ available: wallet.available, locked: wallet.locked }, items, orderMargin);
    return { wallet, positions, items, account };
  }

  async accountDto(userId: string): Promise<FuturesAccountDto> {
    const { account } = await this.evaluate(userId);
    const marginBalance = account.walletBalance.plus(account.totalUnrealizedPnl);
    const available = dmax(ZERO, account.available.plus(dmin(ZERO, account.crossUnrealizedPnl)));
    return {
      asset: 'USDT',
      walletBalance: toPlain(account.walletBalance.toDecimalPlaces(8)),
      availableBalance: toPlain(available.toDecimalPlaces(8)),
      marginBalance: toPlain(marginBalance.toDecimalPlaces(8)),
      unrealizedPnl: toPlain(account.totalUnrealizedPnl.toDecimalPlaces(8)),
      positionMargin: toPlain(account.positionMargin.toDecimalPlaces(8)),
      orderMargin: toPlain(account.orderMargin.toDecimalPlaces(8)),
      maintenanceMargin: toPlain(account.totalMaintenance.toDecimalPlaces(8)),
      marginRatio: marginBalance.gt(0) ? toPlain(account.totalMaintenance.div(marginBalance).toDecimalPlaces(6)) : '0',
    };
  }

  /** Amount that can be moved out of the futures account without endangering positions. */
  maxWithdrawable(account: CrossAccountState): Decimal {
    return dmax(ZERO, account.available.plus(dmin(ZERO, account.crossUnrealizedPnl)));
  }

  async positionDtos(userId: string): Promise<FuturesPositionDto[]> {
    const { items, account } = await this.evaluate(userId);
    const tpsl = await this.core.db.query<{ market_id: number; type: string; stop_price: string }>(
      `SELECT market_id, type, stop_price FROM orders
        WHERE user_id = ? AND market_type = 'FUTURES' AND status = 'NEW' AND trigger_state = 'PENDING' AND close_position = 1`,
      [userId],
    );
    return Promise.all(
      items.map(async ({ pos, market, mark }) => {
        const index = await this.core.prices.indexPrice(market.futures?.underlying ?? market.base);
        const tp = tpsl.find((o) => Number(o.market_id) === pos.marketId && o.type.startsWith('TAKE_PROFIT'));
        const sl = tpsl.find((o) => Number(o.market_id) === pos.marketId && o.type.startsWith('STOP'));
        return this.positionDto(pos, market, mark, index ? D(index) : mark, account, tp?.stop_price ?? null, sl?.stop_price ?? null);
      }),
    );
  }

  positionDto(
    pos: PositionState,
    market: MarketInfo,
    mark: Decimal,
    index: Decimal,
    account: ReturnType<typeof evaluateAccount>,
    tp: string | null = null,
    sl: string | null = null,
  ): FuturesPositionDto {
    const m = account.perPosition.get(pos.id) ?? positionMetrics(pos, market, mark);
    const margin = effectiveMargin(pos, account);
    const liq =
      pos.side && market.futures
        ? liquidationPrice({ side: pos.side, qty: pos.qty, entryPrice: pos.entry, margin, tiers: market.futures.riskTiers })
        : null;
    const bp = pos.side ? bankruptcyPrice(pos.side, pos.qty, pos.entry, margin) : null;
    const marginBalance = pos.marginMode === 'ISOLATED' ? pos.margin.plus(m.unrealizedPnl) : margin.plus(m.unrealizedPnl);
    return {
      symbol: market.symbol,
      side: pos.side ?? 'LONG',
      quantity: toPlain(pos.qty),
      entryPrice: toPlain(pos.entry.toDecimalPlaces(8)),
      markPrice: toPlain(mark),
      indexPrice: toPlain(index),
      liquidationPrice: liq ? toPlain(liq) : null,
      bankruptcyPrice: bp ? toPlain(bp.toDecimalPlaces(8)) : null,
      leverage: pos.leverage,
      marginMode: pos.marginMode,
      margin: toPlain(pos.margin.toDecimalPlaces(8)),
      initialMargin: toPlain(m.initialMargin.toDecimalPlaces(8)),
      maintenanceMargin: toPlain(m.maintenanceMargin.toDecimalPlaces(8)),
      notional: toPlain(m.notional.toDecimalPlaces(8)),
      unrealizedPnl: toPlain(m.unrealizedPnl.toDecimalPlaces(8)),
      realizedPnl: toPlain(pos.realizedPnl.toDecimalPlaces(8)),
      roe: toPlain(roe(m.unrealizedPnl, pos.margin.gt(0) ? pos.margin : m.initialMargin).toDecimalPlaces(6)),
      marginRatio: marginBalance.gt(0) ? toPlain(m.maintenanceMargin.div(marginBalance).toDecimalPlaces(6)) : '1',
      fundingFees: toPlain(pos.fundingFees.toDecimalPlaces(8)),
      takeProfitPrice: tp ? toPlain(tp) : null,
      stopLossPrice: sl ? toPlain(sl) : null,
      updatedAt: Date.now(),
    };
  }

  /** Users holding open positions in any of the given markets (risk engine bootstrap). */
  async usersWithPositions(marketIds?: number[]): Promise<string[]> {
    const rows = await this.core.db.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM futures_positions WHERE status = 'OPEN' AND quantity > 0
       ${marketIds?.length ? `AND market_id IN (${placeholders(marketIds.length)})` : ''}`,
      marketIds ?? [],
    );
    return rows.map((r) => String(r.user_id));
  }

  async fundingHistory(userId: string, limit = 100) {
    const rows = await this.core.db.query<Record<string, unknown>>(
      'SELECT * FROM funding_payments WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      [userId, limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      symbol: this.core.markets.byId(Number(r.market_id))?.symbol ?? '',
      amount: toPlain(String(r.amount)),
      rate: toPlain(String(r.funding_rate)),
      positionQty: toPlain(String(r.position_qty)),
      markPrice: toPlain(String(r.mark_price)),
      fundingTime: toMsStrict(r.funding_time),
    }));
  }

  async liquidationHistory(userId: string, limit = 100) {
    const rows = await this.core.db.query<Record<string, unknown>>('SELECT * FROM liquidations WHERE user_id = ? ORDER BY id DESC LIMIT ?', [
      userId,
      limit,
    ]);
    return rows.map((r) => ({
      id: String(r.id),
      symbol: this.core.markets.byId(Number(r.market_id))?.symbol ?? '',
      side: r.side as PositionSide,
      quantity: toPlain(String(r.quantity)),
      entryPrice: toPlain(String(r.entry_price)),
      markPrice: toPlain(String(r.mark_price)),
      marginMode: r.margin_mode as MarginMode,
      loss: toPlain(D(String(r.realized_pnl)).neg().toFixed()),
      fee: toPlain(String(r.liquidation_fee)),
      createdAt: toMsStrict(r.created_at),
    }));
  }

  requireFutures(symbol: string): MarketInfo {
    const m = this.core.markets.require(symbol, 'FUTURES');
    if (!m.futures) throw new AppError('MARKET_NOT_FOUND', `${symbol} is not a futures contract`);
    return m;
  }
}
