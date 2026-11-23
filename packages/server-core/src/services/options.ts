import type {
  OptionExpiryDto,
  OptionGreeksDto,
  OptionPositionDto,
  OptionQuoteDto,
  OptionsAccountDto,
  OptionsChainDto,
  OrderSide,
  PositionSide,
} from '@gocrypto/shared-types';
import {
  D,
  type Decimal,
  ZERO,
  averageEntryPrice,
  dmin,
  greeks,
  impliedVolatility,
  q18,
  roundToStep,
  shortOptionInitialMargin,
  smileVolatility,
  toPlain,
  yearsUntil,
} from '@gocrypto/trading-utils';
import type { MarketInfo } from '../cache/markets';
import type { Core } from '../core';
import { type Executor, type Tx, toMsStrict } from '../db/database';
import { key } from '../redis';

export interface OptionPositionRow {
  id: string;
  user_id: string;
  market_id: number;
  side: PositionSide | null;
  quantity: string;
  avg_price: string;
  margin: string;
  realized_pnl: string;
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
  version: string;
  updated_at: Date;
}

export interface OptionPositionState {
  id: string;
  userId: string;
  marketId: number;
  side: PositionSide | null;
  qty: Decimal;
  avgPrice: Decimal;
  margin: Decimal;
  realizedPnl: Decimal;
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
  version: number;
  dirty: boolean;
}

export function toOptionState(r: OptionPositionRow): OptionPositionState {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    marketId: Number(r.market_id),
    side: r.side,
    qty: D(r.quantity),
    avgPrice: D(r.avg_price),
    margin: D(r.margin),
    realizedPnl: D(r.realized_pnl),
    status: r.status,
    version: Number(r.version),
    dirty: false,
  };
}

export interface OptionFillEffect {
  closedQty: Decimal;
  openedQty: Decimal;
  realizedPnl: Decimal;
  /** Short-position margin released because of the closed quantity. */
  marginReleased: Decimal;
  /** True when the opened quantity is a short (requires margin). */
  opensShort: boolean;
}

/** Apply an options fill to a position (premium cash flows are handled by the caller). */
export function applyOptionFill(pos: OptionPositionState, side: OrderSide, qty: Decimal, price: Decimal): OptionFillEffect {
  const dir: PositionSide = side === 'BUY' ? 'LONG' : 'SHORT';
  const effect: OptionFillEffect = { closedQty: ZERO, openedQty: ZERO, realizedPnl: ZERO, marginReleased: ZERO, opensShort: false };
  let remaining = qty;
  pos.dirty = true;
  if (pos.side && pos.qty.gt(0) && pos.side !== dir) {
    const close = dmin(pos.qty, remaining);
    const pnl = pos.side === 'LONG' ? price.minus(pos.avgPrice).mul(close) : pos.avgPrice.minus(price).mul(close);
    const released = pos.side === 'SHORT' ? (close.eq(pos.qty) ? pos.margin : q18(pos.margin.mul(close).div(pos.qty))) : ZERO;
    pos.qty = pos.qty.minus(close);
    pos.margin = pos.margin.minus(released);
    pos.realizedPnl = pos.realizedPnl.plus(pnl);
    effect.closedQty = close;
    effect.realizedPnl = q18(pnl);
    effect.marginReleased = released;
    remaining = remaining.minus(close);
    if (pos.qty.isZero()) {
      pos.side = null;
      pos.avgPrice = ZERO;
      pos.margin = ZERO;
      pos.status = 'CLOSED';
    }
  }
  if (remaining.gt(0)) {
    if (!pos.side || pos.qty.isZero()) {
      pos.side = dir;
      pos.avgPrice = price;
      pos.qty = remaining;
      pos.status = 'OPEN';
    } else {
      pos.avgPrice = averageEntryPrice(pos.qty, pos.avgPrice, remaining, price);
      pos.qty = pos.qty.plus(remaining);
    }
    effect.openedQty = remaining;
    effect.opensShort = dir === 'SHORT';
  }
  return effect;
}

const DEFAULT_BASE_IV: Record<string, number> = { BTC: 0.55, ETH: 0.65, SOL: 0.85 };

export class OptionsService {
  constructor(private readonly core: Core) {}

  static baseIvKey(underlying: string): string {
    return key('iv', 'base', underlying);
  }

  async baseIv(underlying: string): Promise<number> {
    const raw = await this.core.redis.main.get(OptionsService.baseIvKey(underlying));
    const v = raw ? Number(raw) : NaN;
    return Number.isFinite(v) && v > 0 ? v : (DEFAULT_BASE_IV[underlying] ?? 0.7);
  }

  /** Theoretical mark (Black-Scholes with a volatility smile), rounded to the tick. */
  markFor(m: MarketInfo, index: number, baseIv: number, nowMs = Date.now()): { mark: Decimal; iv: number; greeks: OptionGreeksDto } {
    const o = m.option!;
    const T = yearsUntil(o.expiryAt, nowMs);
    const strike = Number(o.strike);
    const iv = smileVolatility(baseIv, index, strike, T);
    const g = greeks({ type: o.optionType, spot: index, strike, timeToExpiry: T, volatility: iv, rate: 0 });
    const mark = roundToStep(D(Math.max(g.price, Number(m.tickSize)).toFixed(10)), m.tickSize);
    return { mark, iv, greeks: { delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega } };
  }

  async indexFor(underlying: string): Promise<number | null> {
    const p = await this.core.prices.indexPrice(underlying);
    return p ? Number(p) : null;
  }

  /** Initial margin for selling `qty` contracts. */
  async shortMargin(m: MarketInfo, qty: Decimal): Promise<Decimal> {
    const index = await this.indexFor(m.option!.underlying);
    if (!index) return D(m.option!.strike).mul(qty);
    const { mark } = this.markFor(m, index, await this.baseIv(m.option!.underlying));
    return shortOptionInitialMargin({ type: m.option!.optionType, indexPrice: D(index), strike: m.option!.strike, markPrice: mark, qty });
  }

  async lockPositions(tx: Tx, keys: { userId: string; marketId: number }[], into = new Map<string, OptionPositionState>()) {
    const uniq = [...new Map(keys.map((k) => [`${k.userId}:${k.marketId}`, k])).values()]
      .filter((k) => !into.has(`${k.userId}:${k.marketId}`))
      .sort((a, b) => (a.userId === b.userId ? a.marketId - b.marketId : BigInt(a.userId) < BigInt(b.userId) ? -1 : 1));
    if (!uniq.length) return into;
    const select = (ks: typeof uniq) =>
      tx.query<OptionPositionRow>(
        `SELECT * FROM options_positions WHERE (user_id, market_id) IN (${ks.map(() => '(?, ?)').join(', ')}) ORDER BY user_id, market_id FOR UPDATE`,
        ks.flatMap((k) => [k.userId, k.marketId]),
      );
    for (const r of await select(uniq)) into.set(`${r.user_id}:${r.market_id}`, toOptionState(r));
    const missing = uniq.filter((k) => !into.has(`${k.userId}:${k.marketId}`));
    if (missing.length) {
      for (const k of missing) {
        await tx.execute('INSERT IGNORE INTO options_positions (user_id, market_id) VALUES (?, ?)', [k.userId, k.marketId]);
      }
      for (const r of await select(missing)) into.set(`${r.user_id}:${r.market_id}`, toOptionState(r));
    }
    return into;
  }

  async savePositions(tx: Tx, states: Iterable<OptionPositionState>): Promise<OptionPositionState[]> {
    const saved: OptionPositionState[] = [];
    for (const p of states) {
      if (!p.dirty) continue;
      const res = await tx.execute(
        `UPDATE options_positions SET side = ?, quantity = ?, avg_price = ?, margin = ?, realized_pnl = ?, status = ?, version = version + 1
          WHERE id = ? AND version = ?`,
        [p.side, q18(p.qty).toFixed(18), q18(p.avgPrice).toFixed(18), q18(p.margin).toFixed(18), q18(p.realizedPnl).toFixed(18), p.status, p.id, p.version],
      );
      if (res.affectedRows !== 1) throw new Error(`option position ${p.id} version conflict`);
      p.version += 1;
      p.dirty = false;
      saved.push(p);
    }
    return saved;
  }

  async positionsOf(userId: string, exec: Executor = this.core.db): Promise<OptionPositionState[]> {
    const rows = await exec.query<OptionPositionRow>("SELECT * FROM options_positions WHERE user_id = ? AND status = 'OPEN' AND quantity > 0", [
      userId,
    ]);
    return rows.map(toOptionState);
  }

  async positionDtos(userId: string): Promise<OptionPositionDto[]> {
    const positions = await this.positionsOf(userId);
    const out: OptionPositionDto[] = [];
    for (const p of positions) {
      const m = this.core.markets.byId(p.marketId);
      if (!m?.option) continue;
      const index = (await this.indexFor(m.option.underlying)) ?? Number(m.option.strike);
      const { mark, greeks: g } = this.markFor(m, index, await this.baseIv(m.option.underlying));
      const sign = p.side === 'SHORT' ? -1 : 1;
      const upnl = p.side === 'LONG' ? mark.minus(p.avgPrice).mul(p.qty) : p.avgPrice.minus(mark).mul(p.qty);
      const q = Number(p.qty) * sign;
      out.push({
        symbol: m.symbol,
        underlying: m.option.underlying,
        optionType: m.option.optionType,
        strike: m.option.strike,
        expiry: m.option.expiryAt,
        side: p.side ?? 'LONG',
        quantity: toPlain(p.qty),
        avgPrice: toPlain(p.avgPrice.toDecimalPlaces(8)),
        markPrice: toPlain(mark),
        unrealizedPnl: toPlain(upnl.toDecimalPlaces(8)),
        realizedPnl: toPlain(p.realizedPnl.toDecimalPlaces(8)),
        margin: toPlain(p.margin.toDecimalPlaces(8)),
        greeks: { delta: g.delta * q, gamma: g.gamma * q, theta: g.theta * q, vega: g.vega * q },
        updatedAt: Date.now(),
      });
    }
    return out;
  }

  async accountDto(userId: string): Promise<OptionsAccountDto> {
    const usdt = this.core.assets.require('USDT');
    const w = await this.core.wallet.getWallet(this.core.db, { userId, assetId: usdt.id, account: 'OPTIONS' });
    const positions = await this.positionDtos(userId);
    const upnl = positions.reduce((a, p) => a.plus(p.unrealizedPnl), ZERO);
    // Mark-to-market value of positions: longs are assets, shorts are liabilities.
    const value = positions.reduce((a, p) => a.plus(D(p.markPrice).mul(p.quantity).mul(p.side === 'LONG' ? 1 : -1)), ZERO);
    const available = w?.available ?? ZERO;
    const locked = w?.locked ?? ZERO;
    const sum = (k: keyof OptionGreeksDto) => positions.reduce((a, p) => a + p.greeks[k], 0);
    return {
      asset: 'USDT',
      walletBalance: toPlain(available.plus(locked)),
      availableBalance: toPlain(available),
      locked: toPlain(locked),
      unrealizedPnl: toPlain(upnl.toDecimalPlaces(8)),
      equity: toPlain(available.plus(locked).plus(value).toDecimalPlaces(8)),
      marginUsed: toPlain(positions.reduce((a, p) => a.plus(p.margin), ZERO)),
      greeks: { delta: sum('delta'), gamma: sum('gamma'), theta: sum('theta'), vega: sum('vega') },
    };
  }

  expiries(underlying: string): OptionExpiryDto[] {
    const now = Date.now();
    const map = new Map<number, number>();
    for (const m of this.core.markets.options(underlying)) {
      if (m.status !== 'TRADING' || m.option!.expiryAt <= now) continue;
      map.set(m.option!.expiryAt, (map.get(m.option!.expiryAt) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([expiry, contracts]) => ({ expiry, contracts, daysToExpiry: Math.max(0, Math.round(((expiry - now) / 86_400_000) * 10) / 10) }));
  }

  underlyings(): string[] {
    return [...new Set(this.core.markets.options().map((m) => m.option!.underlying))].sort();
  }

  /** Professional options chain: calls and puts per strike with quotes, IV and Greeks. */
  async chain(underlying: string, expiry: number): Promise<OptionsChainDto> {
    const contracts = this.core.markets.options(underlying).filter((m) => m.option!.expiryAt === expiry && m.status === 'TRADING');
    const index = (await this.indexFor(underlying)) ?? 0;
    const baseIv = await this.baseIv(underlying);
    const symbols = contracts.map((c) => c.symbol);
    const tickers = await this.core.prices.tickers(symbols);
    const oiRows = contracts.length
      ? await this.core.db.query<{ market_id: number; oi: string }>(
          `SELECT market_id, SUM(quantity) AS oi FROM options_positions
            WHERE side = 'LONG' AND status = 'OPEN' AND market_id IN (${contracts.map(() => '?').join(',')}) GROUP BY market_id`,
          contracts.map((c) => c.id),
        )
      : [];
    const oi = new Map(oiRows.map((r) => [Number(r.market_id), toPlain(r.oi)]));
    const T = yearsUntil(expiry);
    const quote = async (m: MarketInfo): Promise<OptionQuoteDto> => {
      const { mark, iv, greeks: g } = this.markFor(m, index, baseIv);
      const book = await this.core.prices.orderBook(m.symbol);
      const t = tickers.get(m.symbol);
      const bid = book?.bids[0] ?? null;
      const ask = book?.asks[0] ?? null;
      const ivOf = (p: string | undefined) =>
        p && index > 0 ? impliedVolatility(Number(p), { type: m.option!.optionType, spot: index, strike: Number(m.option!.strike), timeToExpiry: T, rate: 0 }) : null;
      return {
        symbol: m.symbol,
        bid: bid?.[0] ?? null,
        bidQty: bid?.[1] ?? null,
        ask: ask?.[0] ?? null,
        askQty: ask?.[1] ?? null,
        last: t && D(t.lastPrice).gt(0) ? t.lastPrice : null,
        markPrice: toPlain(mark),
        markIv: iv,
        bidIv: ivOf(bid?.[0]),
        askIv: ivOf(ask?.[0]),
        volume24h: t?.volume ?? '0',
        openInterest: oi.get(m.id) ?? '0',
        greeks: g,
      };
    };
    const strikes = [...new Set(contracts.map((c) => c.option!.strike))].sort((a, b) => D(a).comparedTo(D(b)));
    const rows = await Promise.all(
      strikes.map(async (strike) => {
        const call = contracts.find((c) => c.option!.strike === strike && c.option!.optionType === 'CALL');
        const put = contracts.find((c) => c.option!.strike === strike && c.option!.optionType === 'PUT');
        return { strike, call: call ? await quote(call) : null, put: put ? await quote(put) : null };
      }),
    );
    let atm: string | null = null;
    let best = Infinity;
    for (const s of strikes) {
      const d = Math.abs(Number(s) - index);
      if (d < best) {
        best = d;
        atm = s;
      }
    }
    return { underlying, expiry, indexPrice: String(index), atmStrike: atm, rows, ts: Date.now() };
  }

  async settlements(userId: string, limit = 100) {
    const rows = await this.core.db.query<Record<string, unknown>>(
      'SELECT * FROM options_settlements WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      [userId, limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      symbol: this.core.markets.byId(Number(r.market_id))?.symbol ?? '',
      side: r.side as PositionSide,
      quantity: toPlain(String(r.quantity)),
      strike: toPlain(String(r.strike)),
      settlementPrice: toPlain(String(r.settlement_price)),
      payout: toPlain(String(r.payout)),
      createdAt: toMsStrict(r.created_at),
    }));
  }
}
