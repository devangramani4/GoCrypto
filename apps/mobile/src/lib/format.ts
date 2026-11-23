import { D, type DecimalLike, decimalsOf, formatNumber } from '@gocrypto/trading-utils';

export {
  formatCompact,
  formatNumber,
  formatPercent,
  formatPrice,
  formatQty,
  formatUsd,
  maskEmail,
  shortAddress,
} from '@gocrypto/trading-utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtRelative(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return fmtDate(ts);
}

/** "07:59:12" countdown to a timestamp (clamped at zero). */
export function fmtCountdown(targetTs: number, now = Date.now()): string {
  const total = Math.max(0, Math.floor((targetTs - now) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Axis label for a candle open time, adapted to the timeframe. */
export function fmtAxisTime(ts: number, intraday: boolean): string {
  const d = new Date(ts);
  return intraday ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`;
}

/**
 * Normalises free-form numeric keyboard input into a plain decimal string: digits and one dot,
 * comma accepted as decimal separator, fractional digits capped at `maxDecimals`.
 */
export function sanitizeDecimal(text: string, maxDecimals?: number): string {
  let s = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  if (s.startsWith('.')) s = `0${s}`;
  s = s.replace(/^0+(?=\d)/, '');
  if (maxDecimals !== undefined && dot !== -1) {
    const [i = '', f = ''] = s.split('.');
    s = maxDecimals === 0 ? i : `${i}.${f.slice(0, maxDecimals)}`;
  }
  return s;
}

/** Plain decimal string without trailing zeros ("1.2300" -> "1.23"), "" for zero/invalid. */
export function plain(value: DecimalLike | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  try {
    const d = D(value);
    if (!d.isFinite() || d.isZero()) return '';
    return d.toFixed();
  } catch {
    return '';
  }
}

/** -1 / 0 / 1 for a decimal string; 0 for null or unparsable input. */
export function signOf(value: DecimalLike | null | undefined): -1 | 0 | 1 {
  if (value === null || value === undefined || value === '') return 0;
  try {
    const d = D(value);
    if (d.isZero() || !d.isFinite()) return 0;
    return d.isNegative() ? -1 : 1;
  } catch {
    return 0;
  }
}

/** True when the string parses as a strictly positive decimal. */
export function isPositive(value: string | null | undefined): boolean {
  return signOf(value) === 1;
}

/** Display decimals for a step/tick size string (e.g. "0.001" -> 3). */
export function stepDecimals(step: string | null | undefined, fallback = 2): number {
  if (!step) return fallback;
  try {
    return decimalsOf(step);
  } catch {
    return fallback;
  }
}

/** Signed amount with fixed decimals, e.g. "+12.50" / "-3.10". */
export function fmtSigned(value: DecimalLike | null | undefined, decimals = 2): string {
  return formatNumber(value, decimals, { sign: true });
}

/** 'PARTIALLY_FILLED' -> 'Partially filled' */
export function humanize(code: string): string {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "BTCUSDT-PERP" -> "BTCUSDT", used in compact futures headers. */
export function stripPerp(symbol: string): string {
  return symbol.replace(/-PERP$/, '');
}
