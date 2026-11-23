import { D, type Decimal, formatCompact, formatNumber, formatUsd } from '@gocrypto/trading-utils';

/** Placeholder for missing / unparsable values. */
export const DASH = '—';

/** Parse a decimal string (or integer) without ever throwing; null for anything unusable. */
export function dec(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const d = D(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Amount with up to `maxDp` fraction digits, trailing zeros trimmed: "1,234.5". */
export function fmtAmount(value: unknown, maxDp = 8): string {
  const d = dec(value);
  return d ? formatNumber(d, maxDp, { trim: true }) : DASH;
}

/** Amount with a fixed number of fraction digits: "1,234.50". */
export function fmtFixed(value: unknown, dp = 2): string {
  const d = dec(value);
  return d ? formatNumber(d, dp) : DASH;
}

/** Signed amount: "+1.5" / "-0.25" / "0". */
export function fmtSigned(value: unknown, maxDp = 8): string {
  const d = dec(value);
  return d ? formatNumber(d, maxDp, { trim: true, sign: true }) : DASH;
}

export function fmtUsd(value: unknown, dp = 2): string {
  const d = dec(value);
  return d ? formatUsd(d, dp) : DASH;
}

/** "$1.23M" for large values, "$950.20" otherwise. */
export function fmtUsdCompact(value: unknown): string {
  const d = dec(value);
  if (!d) return DASH;
  if (d.abs().lt(100_000)) return formatUsd(d, 2);
  return `${d.isNegative() ? '-' : ''}$${formatCompact(d.abs(), 2)}`;
}

/** Fee / ratio as a percentage: "0.001" -> "0.1%". */
export function fmtRate(value: unknown, maxDp = 4): string {
  const d = dec(value);
  return d ? `${formatNumber(d.mul(100), maxDp, { trim: true })}%` : DASH;
}

/** A value that is already a percentage number (e.g. 45.3 -> "45.3%"). */
export function fmtPct(n: number | null | undefined, dp = 1): string {
  return n === null || n === undefined || !Number.isFinite(n) ? DASH : `${n.toFixed(dp)}%`;
}

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Counts (not money). */
export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? DASH : INT.format(n);
}

/** Decimal-safe sign of a value: -1, 0, 1 (0 when unparsable). */
export function signOf(value: unknown): -1 | 0 | 1 {
  const d = dec(value);
  if (!d || d.isZero()) return 0;
  return d.isNegative() ? -1 : 1;
}

// ───────────────────────────── time ─────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** Accepts epoch ms, ISO strings and Dates (raw DB rows serialise DATETIME as ISO strings). */
export function toMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'string' && value) {
    if (/^\d+$/.test(value)) return Number(value);
    const n = Date.parse(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Local date-time: "2026-11-23 14:05:09". */
export function fmtDateTime(value: unknown, seconds = true): string {
  const ms = toMs(value);
  if (ms === null) return DASH;
  const d = new Date(ms);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${base}:${pad(d.getSeconds())}` : base;
}

export function fmtDate(value: unknown): string {
  const ms = toMs(value);
  if (ms === null) return DASH;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Unambiguous UTC rendering for tooltips. */
export function fmtUtc(value: unknown): string {
  const ms = toMs(value);
  return ms === null ? '' : `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function fmtRelative(value: unknown, now = Date.now()): string {
  const ms = toMs(value);
  if (ms === null) return DASH;
  const diff = now - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);
  if (abs < 5_000) return 'just now';
  if (abs < 60_000) return wrap(`${Math.round(abs / 1000)}s`);
  if (abs < 3_600_000) return wrap(`${Math.round(abs / 60_000)}m`);
  if (abs < 86_400_000) return wrap(`${Math.round(abs / 3_600_000)}h`);
  if (abs < 30 * 86_400_000) return wrap(`${Math.round(abs / 86_400_000)}d`);
  return fmtDate(ms);
}

export function fmtDuration(totalSec: number | null | undefined): string {
  if (totalSec === null || totalSec === undefined || !Number.isFinite(totalSec) || totalSec < 0) return DASH;
  const s = Math.floor(totalSec);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return DASH;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** yyyy-mm-dd (local) for <input type="date"> values. */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight (start) or end-of-day (end) epoch ms for a yyyy-mm-dd input value. */
export function fromDateInput(value: string, edge: 'start' | 'end'): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = edge === 'start' ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
