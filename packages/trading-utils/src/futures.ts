import { D, type Decimal, type DecimalLike, ONE, ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, ZERO, dmax, q18, q18Up } from './decimal';

export type PositionSide = 'LONG' | 'SHORT';

/** A maintenance-margin bracket ("risk limit tier"). */
export interface RiskTier {
  tier: number;
  /** Upper notional bound (inclusive) of this bracket, in settle asset. */
  maxNotional: string;
  maxLeverage: number;
  /** Maintenance margin rate, e.g. "0.004" = 0.4%. */
  maintenanceMarginRate: string;
  /** Maintenance amount ("cum") deducted so brackets are continuous. */
  maintenanceAmount: string;
}

export function direction(side: PositionSide): 1 | -1 {
  return side === 'LONG' ? 1 : -1;
}

export function notional(qty: DecimalLike, price: DecimalLike): Decimal {
  return D(qty).abs().mul(price);
}

/** Unrealised PnL of a position at a given mark price. */
export function unrealizedPnl(side: PositionSide, qty: DecimalLike, entryPrice: DecimalLike, markPrice: DecimalLike): Decimal {
  return D(markPrice).minus(entryPrice).mul(qty).mul(direction(side));
}

/** Realised PnL when closing `closeQty` of a position at `exitPrice`. */
export function realizedPnl(side: PositionSide, closeQty: DecimalLike, entryPrice: DecimalLike, exitPrice: DecimalLike): Decimal {
  return q18(D(exitPrice).minus(entryPrice).mul(closeQty).mul(direction(side)), ROUND_HALF_UP);
}

/** Initial margin required to open `notional` at `leverage` (rounded up). */
export function initialMargin(notionalValue: DecimalLike, leverage: DecimalLike): Decimal {
  const lev = D(leverage);
  if (lev.lte(0)) throw new Error('leverage must be positive');
  return q18Up(D(notionalValue).div(lev));
}

/** Pick the risk tier that applies to a notional value (last tier if above every bound). */
export function tierForNotional(tiers: readonly RiskTier[], notionalValue: DecimalLike): RiskTier {
  if (tiers.length === 0) throw new Error('no risk tiers configured');
  const sorted = [...tiers].sort((a, b) => a.tier - b.tier);
  const n = D(notionalValue);
  for (const t of sorted) {
    if (n.lte(t.maxNotional)) return t;
  }
  return sorted[sorted.length - 1]!;
}

/** Maximum leverage allowed for a notional value. */
export function maxLeverageForNotional(tiers: readonly RiskTier[], notionalValue: DecimalLike): number {
  return tierForNotional(tiers, notionalValue).maxLeverage;
}

/** Maintenance margin of a position: notional * mmr - maintenanceAmount (never negative). */
export function maintenanceMargin(tiers: readonly RiskTier[], qty: DecimalLike, markPrice: DecimalLike): Decimal {
  const n = notional(qty, markPrice);
  const tier = tierForNotional(tiers, n);
  return q18Up(dmax(ZERO, n.mul(tier.maintenanceMarginRate).minus(tier.maintenanceAmount)));
}

/**
 * Liquidation price for a position given the margin that backs it.
 *
 *   long : P = (E*Q - M - cum) / (Q * (1 - mmr))
 *   short: P = (E*Q + M + cum) / (Q * (1 + mmr))
 *
 * For isolated positions `margin` is the isolated margin. For cross positions pass the cross
 * margin available to this position (wallet balance - isolated margins + other positions' uPnL
 * - other positions' maintenance margin). Returns null when the position cannot be liquidated
 * (price would be <= 0).
 */
export function liquidationPrice(params: {
  side: PositionSide;
  qty: DecimalLike;
  entryPrice: DecimalLike;
  margin: DecimalLike;
  tiers: readonly RiskTier[];
}): Decimal | null {
  const Q = D(params.qty).abs();
  if (Q.isZero()) return null;
  const E = D(params.entryPrice);
  const M = D(params.margin);
  // Tier depends on notional at liquidation; iterate to a fixed point (converges in 1-2 steps).
  let tier = tierForNotional(params.tiers, notional(Q, E));
  let price: Decimal | null = null;
  for (let i = 0; i < 4; i++) {
    const mmr = D(tier.maintenanceMarginRate);
    const cum = D(tier.maintenanceAmount);
    const p =
      params.side === 'LONG'
        ? E.mul(Q).minus(M).minus(cum).div(Q.mul(ONE.minus(mmr)))
        : E.mul(Q).plus(M).plus(cum).div(Q.mul(ONE.plus(mmr)));
    price = p;
    const next = tierForNotional(params.tiers, notional(Q, p.gt(0) ? p : E));
    if (next.tier === tier.tier) break;
    tier = next;
  }
  if (price === null || price.lte(0)) return null;
  return price.toDecimalPlaces(8, params.side === 'LONG' ? ROUND_UP : ROUND_DOWN);
}

/** Bankruptcy price: where the position's margin is exactly exhausted. */
export function bankruptcyPrice(side: PositionSide, qty: DecimalLike, entryPrice: DecimalLike, margin: DecimalLike): Decimal {
  const Q = D(qty).abs();
  if (Q.isZero()) return D(entryPrice);
  const perUnit = D(margin).div(Q);
  const p = side === 'LONG' ? D(entryPrice).minus(perUnit) : D(entryPrice).plus(perUnit);
  return dmax(ZERO, p);
}

/** New average entry price after increasing a position. */
export function averageEntryPrice(
  currentQty: DecimalLike,
  currentEntry: DecimalLike,
  addQty: DecimalLike,
  addPrice: DecimalLike,
): Decimal {
  const q0 = D(currentQty).abs();
  const q1 = D(addQty).abs();
  const total = q0.plus(q1);
  if (total.isZero()) return ZERO;
  return D(currentEntry).mul(q0).plus(D(addPrice).mul(q1)).div(total).toDecimalPlaces(18);
}

/**
 * Funding payment for a position. Positive result = account receives, negative = account pays.
 * With a positive rate longs pay shorts.
 */
export function fundingPayment(side: PositionSide, qty: DecimalLike, markPrice: DecimalLike, rate: DecimalLike): Decimal {
  const amount = notional(qty, markPrice).mul(rate);
  return q18(side === 'LONG' ? amount.neg() : amount);
}

/**
 * Funding rate formula (Binance-style):
 *   F = P + clamp(I - P, -0.05%, +0.05%), then clamped to ±cap.
 * `premiumIndex` is the time-weighted average of (impact mid - index) / index.
 */
export function fundingRate(premiumIndex: DecimalLike, interestRate: DecimalLike = '0.0001', cap: DecimalLike = '0.0075'): Decimal {
  const P = D(premiumIndex);
  const I = D(interestRate);
  const diff = I.minus(P);
  const band = D('0.0005');
  const clampedDiff = diff.gt(band) ? band : diff.lt(band.neg()) ? band.neg() : diff;
  const raw = P.plus(clampedDiff);
  const c = D(cap);
  const capped = raw.gt(c) ? c : raw.lt(c.neg()) ? c.neg() : raw;
  return capped.toDecimalPlaces(8);
}

/** Return on equity of a position (uPnL / initial margin). */
export function roe(pnl: DecimalLike, margin: DecimalLike): Decimal {
  const m = D(margin);
  if (m.isZero()) return ZERO;
  return D(pnl).div(m);
}

/** Margin ratio = maintenance margin / margin balance. >= 1 means liquidation. */
export function marginRatio(maintenance: DecimalLike, marginBalance: DecimalLike): Decimal {
  const mb = D(marginBalance);
  if (mb.lte(0)) return D(Infinity);
  return D(maintenance).div(mb);
}
