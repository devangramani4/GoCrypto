import { D } from '@gocrypto/trading-utils';
import { useEffect, useRef, useState } from 'react';
import { formatNumber, formatPercent, formatPrice, formatUsd, signOf } from '../lib/format';
import { useTheme } from '../theme';
import { Txt, type TxtProps } from './Txt';

interface PriceTextProps extends Omit<TxtProps, 'children'> {
  value: string | null | undefined;
  /** Tick size used for decimals (default 0.01). */
  tickSize?: string;
  /**
   * Coloring: 'tick' = green/red by the direction of the last change (live prices),
   * 'sign' = by the value's sign, a decimal string = relative to that reference (e.g. 24h open),
   * 'none' = plain text color.
   */
  colorBy?: 'tick' | 'sign' | 'none' | { reference: string | null | undefined };
}

/** Price with tabular figures and up/down coloring. */
export function PriceText({ value, tickSize = '0.01', colorBy = 'tick', ...rest }: PriceTextProps) {
  const t = useTheme();
  const prev = useRef<string | null | undefined>(value);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);

  useEffect(() => {
    if (colorBy !== 'tick') return;
    const before = prev.current;
    prev.current = value;
    if (!before || !value || before === value) return;
    try {
      const cmp = D(value).comparedTo(D(before));
      if (cmp !== 0) setDirection(cmp > 0 ? 1 : -1);
    } catch {
      // ignore unparsable values
    }
  }, [value, colorBy]);

  let sign: -1 | 0 | 1 = 0;
  if (colorBy === 'tick') sign = direction;
  else if (colorBy === 'sign') sign = signOf(value);
  else if (typeof colorBy === 'object' && colorBy.reference && value) {
    try {
      sign = signOf(D(value).minus(colorBy.reference));
    } catch {
      sign = 0;
    }
  }
  const color = sign > 0 ? t.colors.up : sign < 0 ? t.colors.down : rest.color;

  return (
    <Txt numeric {...rest} color={color}>
      {formatPrice(value, tickSize)}
    </Txt>
  );
}

interface PnLTextProps extends Omit<TxtProps, 'children'> {
  /** Signed amount (decimal string). */
  value: string | null | undefined;
  /** Optional ratio shown in parentheses (0.0523 -> +5.23%). */
  ratio?: string | null;
  /** Format the amount as USD ($) instead of a plain number. */
  usd?: boolean;
  decimals?: number;
  /** Text appended after the amount (e.g. " USDT"). */
  unit?: string;
}

/** Profit & loss: always signed and colored green (gain) / red (loss). */
export function PnLText({ value, ratio, usd = false, decimals = 2, unit, ...rest }: PnLTextProps) {
  const t = useTheme();
  const sign = signOf(value);
  const color = sign > 0 ? t.colors.up : sign < 0 ? t.colors.down : t.colors.textMuted;
  const amount = usd
    ? `${sign > 0 ? '+' : ''}${formatUsd(value, decimals)}`
    : formatNumber(value, decimals, { sign: true });
  const pct = ratio !== undefined && ratio !== null ? ` (${formatPercent(ratio)})` : '';
  return (
    <Txt numeric {...rest} color={color}>
      {amount}
      {unit ?? ''}
      {pct}
    </Txt>
  );
}

/** Colored percentage pill text for 24h change. */
export function ChangeText({ ratio, ...rest }: Omit<TxtProps, 'children'> & { ratio: string | null | undefined }) {
  const t = useTheme();
  const sign = signOf(ratio);
  return (
    <Txt numeric {...rest} color={sign > 0 ? t.colors.up : sign < 0 ? t.colors.down : t.colors.textMuted}>
      {formatPercent(ratio ?? '0')}
    </Txt>
  );
}
