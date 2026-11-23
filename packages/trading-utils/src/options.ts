import { D, type Decimal, type DecimalLike, ZERO, dmax, q18Up } from './decimal';

/**
 * Black-Scholes (European, cash-settled) pricing and Greeks.
 *
 * Model inputs/outputs are IEEE doubles because pricing is an estimate (mark price, quotes,
 * Greeks); any premium that becomes money is rounded to the market tick and converted to Decimal
 * before it touches balances.
 */
export type OptionType = 'CALL' | 'PUT';

export interface BlackScholesInput {
  type: OptionType;
  /** Underlying (index) price. */
  spot: number;
  strike: number;
  /** Time to expiry in years. */
  timeToExpiry: number;
  /** Annualised volatility, e.g. 0.6 = 60%. */
  volatility: number;
  /** Annualised risk-free rate. */
  rate?: number;
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  /** Theta per calendar day. */
  theta: number;
  /** Vega per 1 vol point (1%). */
  vega: number;
  /** Rho per 1% rate change. */
  rho: number;
}

export const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** Standard normal probability density. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal CDF using the Hart (1968) / West (2005) double-precision algorithm
 * (absolute error ~1e-15).
 */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) {
    c = 0;
  } else {
    const e = Math.exp(-(z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else {
      let d = z + 0.65;
      d = z + 4 / d;
      d = z + 3 / d;
      d = z + 2 / d;
      d = z + 1 / d;
      c = e / d / 2.506628274631;
    }
  }
  return x <= 0 ? c : 1 - c;
}

function d1d2(i: BlackScholesInput): { d1: number; d2: number; sqrtT: number } {
  const r = i.rate ?? 0;
  const sqrtT = Math.sqrt(i.timeToExpiry);
  const d1 = (Math.log(i.spot / i.strike) + (r + (i.volatility * i.volatility) / 2) * i.timeToExpiry) / (i.volatility * sqrtT);
  return { d1, d2: d1 - i.volatility * sqrtT, sqrtT };
}

/** Intrinsic value of an option at a given underlying price. */
export function intrinsicValue(type: OptionType, spot: number, strike: number): number {
  return type === 'CALL' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

/** Black-Scholes premium. Falls back to intrinsic value at/after expiry or with zero volatility. */
export function blackScholesPrice(i: BlackScholesInput): number {
  if (i.timeToExpiry <= 0 || i.volatility <= 0 || i.spot <= 0 || i.strike <= 0) {
    return intrinsicValue(i.type, i.spot, i.strike);
  }
  const r = i.rate ?? 0;
  const { d1, d2 } = d1d2(i);
  const df = Math.exp(-r * i.timeToExpiry);
  if (i.type === 'CALL') return i.spot * normCdf(d1) - i.strike * df * normCdf(d2);
  return i.strike * df * normCdf(-d2) - i.spot * normCdf(-d1);
}

/** Full Greeks. */
export function greeks(i: BlackScholesInput): Greeks {
  const price = blackScholesPrice(i);
  if (i.timeToExpiry <= 0 || i.volatility <= 0 || i.spot <= 0 || i.strike <= 0) {
    const itm = intrinsicValue(i.type, i.spot, i.strike) > 0;
    return { price, delta: itm ? (i.type === 'CALL' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const r = i.rate ?? 0;
  const { d1, d2, sqrtT } = d1d2(i);
  const df = Math.exp(-r * i.timeToExpiry);
  const pdf = normPdf(d1);
  const gamma = pdf / (i.spot * i.volatility * sqrtT);
  const vega = (i.spot * pdf * sqrtT) / 100;
  let delta: number;
  let thetaYear: number;
  let rho: number;
  if (i.type === 'CALL') {
    delta = normCdf(d1);
    thetaYear = (-i.spot * pdf * i.volatility) / (2 * sqrtT) - r * i.strike * df * normCdf(d2);
    rho = (i.strike * i.timeToExpiry * df * normCdf(d2)) / 100;
  } else {
    delta = normCdf(d1) - 1;
    thetaYear = (-i.spot * pdf * i.volatility) / (2 * sqrtT) + r * i.strike * df * normCdf(-d2);
    rho = (-i.strike * i.timeToExpiry * df * normCdf(-d2)) / 100;
  }
  return { price, delta, gamma, theta: thetaYear / 365, vega, rho };
}

/**
 * Implied volatility from a premium (Newton-Raphson with bisection fallback).
 * Returns null when the price is outside no-arbitrage bounds.
 */
export function impliedVolatility(
  price: number,
  params: Omit<BlackScholesInput, 'volatility'>,
  opts: { tolerance?: number; maxIterations?: number } = {},
): number | null {
  const tol = opts.tolerance ?? 1e-6;
  const maxIt = opts.maxIterations ?? 100;
  if (params.timeToExpiry <= 0 || price <= 0) return null;
  const intrinsic = intrinsicValue(params.type, params.spot, params.strike);
  const upper = params.type === 'CALL' ? params.spot : params.strike;
  if (price < intrinsic - 1e-9 || price >= upper) return null;

  let lo = 1e-4;
  let hi = 10;
  let sigma = 0.6;
  for (let k = 0; k < maxIt; k++) {
    const p = blackScholesPrice({ ...params, volatility: sigma });
    const diff = p - price;
    if (Math.abs(diff) < tol) return sigma;
    if (diff > 0) hi = sigma;
    else lo = sigma;
    const { d1, sqrtT } = d1d2({ ...params, volatility: sigma });
    const vegaRaw = params.spot * normPdf(d1) * sqrtT;
    let next = vegaRaw > 1e-8 ? sigma - diff / vegaRaw : (lo + hi) / 2;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    sigma = next;
  }
  return Math.abs(blackScholesPrice({ ...params, volatility: sigma }) - price) < tol * 100 ? sigma : null;
}

/** Simple volatility smile: base IV + skew * log-moneyness^2 (+ slight put skew). */
export function smileVolatility(baseIv: number, spot: number, strike: number, timeToExpiry: number): number {
  const m = Math.log(strike / spot);
  const t = Math.max(timeToExpiry, 1 / 365);
  const curvature = 0.8 / Math.sqrt(t * 12);
  const skew = m < 0 ? -0.15 * m : 0;
  return Math.min(3, Math.max(0.05, baseIv + curvature * m * m + skew));
}

export function yearsUntil(expiryMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, (expiryMs - nowMs) / MS_PER_YEAR);
}

/**
 * Initial margin for one short option contract (per unit of underlying), Deribit/Binance style:
 *   call: max(0.15*S - OTM, 0.10*S) + mark
 *   put : max(0.15*S - OTM, 0.10*K) + mark
 */
export function shortOptionInitialMargin(params: {
  type: OptionType;
  indexPrice: DecimalLike;
  strike: DecimalLike;
  markPrice: DecimalLike;
  qty: DecimalLike;
}): Decimal {
  const S = D(params.indexPrice);
  const K = D(params.strike);
  const otm = params.type === 'CALL' ? dmax(ZERO, K.minus(S)) : dmax(ZERO, S.minus(K));
  const floor = params.type === 'CALL' ? S.mul('0.10') : K.mul('0.10');
  const perUnit = dmax(S.mul('0.15').minus(otm), floor).plus(params.markPrice);
  return q18Up(perUnit.mul(params.qty));
}

/** Maintenance margin for one short option contract: 0.075*S + mark (per unit). */
export function shortOptionMaintenanceMargin(params: { indexPrice: DecimalLike; markPrice: DecimalLike; qty: DecimalLike }): Decimal {
  return q18Up(D(params.indexPrice).mul('0.075').plus(params.markPrice).mul(params.qty));
}

/** Settlement payoff per unit at expiry. */
export function optionPayoff(type: OptionType, settlementPrice: DecimalLike, strike: DecimalLike): Decimal {
  const S = D(settlementPrice);
  const K = D(strike);
  return type === 'CALL' ? dmax(ZERO, S.minus(K)) : dmax(ZERO, K.minus(S));
}
