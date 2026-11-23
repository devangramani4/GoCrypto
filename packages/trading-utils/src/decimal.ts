import DecimalJS from 'decimal.js';

/**
 * Isolated Decimal constructor used for every financial calculation in GoCrypto.
 *
 * Rules:
 *  - Money, prices, quantities, fees and margins are NEVER JavaScript floats.
 *  - Values travel over the wire and to the database as strings.
 *  - Storage precision is DECIMAL(36,18): quantize with {@link q18} before persisting.
 */
export const Decimal = DecimalJS.clone({
  precision: 60,
  rounding: DecimalJS.ROUND_HALF_UP,
  toExpNeg: -60,
  toExpPos: 60,
});
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Decimal = DecimalJS;
export type DecimalLike = DecimalJS.Value;

export const ROUND_UP = DecimalJS.ROUND_UP;
export const ROUND_DOWN = DecimalJS.ROUND_DOWN;
export const ROUND_HALF_UP = DecimalJS.ROUND_HALF_UP;
export const ROUND_FLOOR = DecimalJS.ROUND_FLOOR;
export const ROUND_CEIL = DecimalJS.ROUND_CEIL;

/** Number of fractional digits stored in the database for every amount column. */
export const STORAGE_SCALE = 18;

export const ZERO: Decimal = new Decimal(0);
export const ONE: Decimal = new Decimal(1);

/** Construct a Decimal. Accepts strings (preferred), integers, or other Decimals. */
export function D(value: DecimalLike | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return ZERO;
  if (value instanceof DecimalJS) return value as Decimal;
  return new Decimal(value);
}

/** True when the input parses as a finite decimal number. */
export function isDecimalString(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(value.trim())) return false;
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

/** Quantize to storage scale (18 dp). Defaults to ROUND_DOWN so credits are never over-stated. */
export function q18(value: DecimalLike, rounding: DecimalJS.Rounding = ROUND_DOWN): Decimal {
  return D(value).toDecimalPlaces(STORAGE_SCALE, rounding);
}

/** Quantize a charge (fee / required margin) — always rounds UP so the platform is never short. */
export function q18Up(value: DecimalLike): Decimal {
  return D(value).toDecimalPlaces(STORAGE_SCALE, ROUND_UP);
}

/** Serialise for the database (fixed 18dp, no exponent). */
export function toDb(value: DecimalLike): string {
  return q18(value).toFixed(STORAGE_SCALE);
}

/** Serialise for APIs: plain notation, no exponent, trailing zeros removed. */
export function toPlain(value: DecimalLike | null | undefined): string {
  if (value === null || value === undefined) return '0';
  const d = D(value);
  if (d.isZero()) return '0';
  return d.toFixed();
}

export function dmin(...values: DecimalLike[]): Decimal {
  if (values.length === 0) throw new Error('dmin requires at least one value');
  return Decimal.min(...values) as Decimal;
}

export function dmax(...values: DecimalLike[]): Decimal {
  if (values.length === 0) throw new Error('dmax requires at least one value');
  return Decimal.max(...values) as Decimal;
}

export function dsum(values: Iterable<DecimalLike>): Decimal {
  let acc: Decimal = ZERO;
  for (const v of values) acc = acc.plus(D(v));
  return acc;
}

export function clamp(value: DecimalLike, lo: DecimalLike, hi: DecimalLike): Decimal {
  return dmin(dmax(value, lo), hi);
}

/** Number of fractional digits of a step/tick (e.g. "0.0010" -> 3). */
export function decimalsOf(step: DecimalLike): number {
  return D(step).decimalPlaces();
}

/** Floor to a multiple of step (used for quantities derived from budgets). */
export function floorToStep(value: DecimalLike, step: DecimalLike): Decimal {
  const s = D(step);
  if (s.lte(0)) return D(value);
  return D(value).div(s).floor().mul(s);
}

/** Ceil to a multiple of step. */
export function ceilToStep(value: DecimalLike, step: DecimalLike): Decimal {
  const s = D(step);
  if (s.lte(0)) return D(value);
  return D(value).div(s).ceil().mul(s);
}

/** Round to the nearest multiple of step (half up). */
export function roundToStep(value: DecimalLike, step: DecimalLike): Decimal {
  const s = D(step);
  if (s.lte(0)) return D(value);
  return D(value).div(s).toDecimalPlaces(0, ROUND_HALF_UP).mul(s);
}

/** True when value is an exact multiple of step. */
export function isMultipleOf(value: DecimalLike, step: DecimalLike): boolean {
  const s = D(step);
  if (s.lte(0)) return true;
  return D(value).mod(s).isZero();
}

/** Percentage change from `from` to `to` (e.g. 0.0523 = +5.23%). Returns 0 when `from` is zero. */
export function pctChange(from: DecimalLike, to: DecimalLike): Decimal {
  const f = D(from);
  if (f.isZero()) return ZERO;
  return D(to).minus(f).div(f);
}

/** Compare helper usable in Array.sort. */
export function compareDecimal(a: DecimalLike, b: DecimalLike): number {
  return D(a).comparedTo(D(b));
}
