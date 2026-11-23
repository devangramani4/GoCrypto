import type { OptionType } from './options';

/** Futures perpetual symbol: BTCUSDT-PERP */
export function perpSymbol(base: string, quote: string): string {
  return `${base}${quote}-PERP`;
}

export function isPerpSymbol(symbol: string): boolean {
  return symbol.endsWith('-PERP');
}

const OPTION_RE = /^([A-Z0-9]{2,10})-(\d{2})(\d{2})(\d{2})-(\d+(?:\.\d+)?)-(C|P)$/;

export interface ParsedOptionSymbol {
  underlying: string;
  /** Expiry timestamp (ms, 08:00 UTC on expiry date). */
  expiry: number;
  strike: string;
  type: OptionType;
}

export const OPTION_EXPIRY_HOUR_UTC = 8;

/** Option symbol, e.g. BTC-261127-90000-C (expiring 2026-11-27 08:00 UTC). */
export function formatOptionSymbol(underlying: string, expiryMs: number, strike: string, type: OptionType): string {
  const d = new Date(expiryMs);
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${underlying}-${yy}${mm}${dd}-${strike}-${type === 'CALL' ? 'C' : 'P'}`;
}

export function parseOptionSymbol(symbol: string): ParsedOptionSymbol | null {
  const m = OPTION_RE.exec(symbol);
  if (!m) return null;
  const [, underlying, yy, mm, dd, strike, cp] = m;
  const expiry = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), OPTION_EXPIRY_HOUR_UTC);
  return { underlying: underlying!, expiry, strike: strike!, type: cp === 'C' ? 'CALL' : 'PUT' };
}

export function isOptionSymbol(symbol: string): boolean {
  return OPTION_RE.test(symbol);
}

/** "BTCUSDT" + base/quote -> "BTC/USDT" */
export function displayPair(base: string, quote: string): string {
  return `${base}/${quote}`;
}
