import { dec } from './format';

const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/** Fee rates mirror the API rules: decimal, below 0.1 (10%); maker rates may be negative (rebates). */
export function validateRate(value: string, allowNegative: boolean): string | null {
  const v = value.trim();
  if (!v) return 'Required';
  if (!(allowNegative ? SIGNED_DECIMAL : DECIMAL).test(v)) return allowNegative ? 'Decimal rate, e.g. 0.0002 or -0.0001' : 'Decimal rate, e.g. 0.0005';
  const d = dec(v);
  if (!d || d.abs().gte('0.1')) return 'Must be below 0.1 (10%)';
  return null;
}

export function isDecimal(value: string, opts: { signed?: boolean } = {}): boolean {
  return (opts.signed ? SIGNED_DECIMAL : DECIMAL).test(value.trim());
}
