import type { MarketDto } from '@gocrypto/shared-types';
import { D, autoPriceDecimals, formatCompact, formatNumber, formatPercent, formatUsd } from '@gocrypto/trading-utils';

export { formatCompact, formatNumber, formatPercent, formatUsd };

export function fmtPrice(value: string | null | undefined, market?: Pick<MarketDto, 'pricePrecision'> | null): string {
  if (value === null || value === undefined || value === '') return '—';
  return formatNumber(value, market ? market.pricePrecision : autoPriceDecimals(value));
}

export function fmtQty(value: string | null | undefined, market?: Pick<MarketDto, 'qtyPrecision'> | null): string {
  if (value === null || value === undefined || value === '') return '—';
  return formatNumber(value, market ? market.qtyPrecision : 6, { truncate: true, trim: !market });
}

export function fmtAmount(value: string | null | undefined, decimals = 8): string {
  if (value === null || value === undefined || value === '') return '—';
  return formatNumber(value, decimals, { trim: true });
}

export function signClass(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const d = D(value);
  return d.gt(0) ? 'up' : d.lt(0) ? 'down' : '';
}

export function fmtTime(ts: number, withDate = true): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour12: false });
  if (!withDate) return time;
  return `${d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })} ${time}`;
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function humanize(code: string): string {
  return code
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Coin color for avatar badges (deterministic). */
const COIN_COLORS: Record<string, string> = {
  BTC: '#F7931A',
  ETH: '#627EEA',
  USDT: '#26A17B',
  USDC: '#2775CA',
  SOL: '#9945FF',
  BNB: '#F3BA2F',
  XRP: '#23292F',
  DOGE: '#C2A633',
  ADA: '#0033AD',
  LINK: '#2A5ADA',
};

export function coinColor(asset: string): string {
  if (COIN_COLORS[asset]) return COIN_COLORS[asset]!;
  let h = 0;
  for (const c of asset) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 50%)`;
}

/** Keep only a well-formed non-negative decimal with at most `decimals` fraction digits. */
export function sanitizeDecimal(raw: string, decimals: number): string {
  let v = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) {
    const int = v.slice(0, dot) || '0';
    const frac = v.slice(dot + 1).replace(/\./g, '');
    v = decimals <= 0 ? int : `${int}.${frac.slice(0, decimals)}`;
  }
  return v.replace(/^0+(?=\d)/, '');
}

/** True for a parseable decimal string greater than zero. */
export function isPositive(v: string | null | undefined): boolean {
  if (!v) return false;
  try {
    return D(v).gt(0);
  } catch {
    return false;
  }
}
