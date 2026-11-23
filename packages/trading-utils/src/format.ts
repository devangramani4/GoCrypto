import { D, type DecimalLike, ROUND_DOWN, ROUND_HALF_UP } from './decimal';

function groupThousands(intPart: string): string {
  const neg = intPart.startsWith('-');
  const digits = neg ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/**
 * Exact decimal formatting with thousands separators (no float conversion).
 * @param decimals fixed number of fractional digits
 */
export function formatNumber(
  value: DecimalLike | null | undefined,
  decimals = 2,
  opts: { trim?: boolean; truncate?: boolean; sign?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return '—';
  let d;
  try {
    d = D(value);
  } catch {
    return '—';
  }
  if (!d.isFinite()) return '—';
  let s = d.toFixed(decimals, opts.truncate ? ROUND_DOWN : ROUND_HALF_UP);
  if (opts.trim && s.includes('.')) s = s.replace(/\.?0+$/, '');
  const [i, f] = s.split('.');
  const body = f !== undefined ? `${groupThousands(i!)}.${f}` : groupThousands(i!);
  if (opts.sign && d.gt(0)) return `+${body}`;
  return body === '-0' || /^-0\.0*$/.test(body) ? body.slice(1) : body;
}

export function formatPrice(value: DecimalLike | null | undefined, tickSize = '0.01'): string {
  return formatNumber(value, D(tickSize).decimalPlaces());
}

export function formatQty(value: DecimalLike | null | undefined, stepSize = '0.00001'): string {
  return formatNumber(value, D(stepSize).decimalPlaces(), { truncate: true });
}

/** Ratio -> percentage string, e.g. 0.0523 -> "+5.23%". */
export function formatPercent(ratio: DecimalLike | null | undefined, decimals = 2, sign = true): string {
  if (ratio === null || ratio === undefined || ratio === '') return '—';
  const pct = D(ratio).mul(100);
  return `${formatNumber(pct, decimals, { sign })}%`;
}

export function formatUsd(value: DecimalLike | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = D(value);
  const s = formatNumber(d.abs(), decimals);
  return d.isNegative() && !d.isZero() ? `-$${s}` : `$${s}`;
}

/** Compact notation: 1.23K, 4.56M, 7.89B. */
export function formatCompact(value: DecimalLike | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = D(value);
  const abs = d.abs();
  const units: [string, string][] = [
    ['1e12', 'T'],
    ['1e9', 'B'],
    ['1e6', 'M'],
    ['1e3', 'K'],
  ];
  for (const [threshold, suffix] of units) {
    if (abs.gte(threshold)) return `${formatNumber(d.div(threshold), decimals)}${suffix}`;
  }
  return formatNumber(d, decimals);
}

/** Choose sensible display decimals for an arbitrary price magnitude. */
export function autoPriceDecimals(value: DecimalLike): number {
  const v = D(value).abs();
  if (v.gte(1000)) return 2;
  if (v.gte(1)) return 4;
  if (v.gte('0.01')) return 6;
  return 8;
}

/** Mask an email for display: j***@example.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user[0]}${'*'.repeat(Math.max(2, Math.min(5, user.length - 1)))}@${domain}`;
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
