import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme, type AppTheme } from '../theme';

export type TextVariant = 'display' | 'title' | 'heading' | 'subtitle' | 'body' | 'label' | 'caption' | 'micro';
export type TextTone = 'default' | 'muted' | 'faint' | 'brand' | 'up' | 'down' | 'warn' | 'info' | 'onBrand';
type Weight = keyof AppTheme['fontWeight'];

export interface TxtProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Explicit color (overrides `tone`). */
  color?: string;
  weight?: Weight;
  align?: TextStyle['textAlign'];
  /** Tabular (fixed-width) figures for prices, sizes and balances. */
  numeric?: boolean;
  mono?: boolean;
}

function variantStyle(t: AppTheme, v: TextVariant): TextStyle {
  const s = t.fontSize;
  const w = t.fontWeight;
  switch (v) {
    case 'display':
      return { fontSize: s.display, lineHeight: 40, fontWeight: w.bold, letterSpacing: -0.5 };
    case 'title':
      return { fontSize: s.xxl, lineHeight: 30, fontWeight: w.bold, letterSpacing: -0.3 };
    case 'heading':
      return { fontSize: s.xl, lineHeight: 26, fontWeight: w.semibold };
    case 'subtitle':
      return { fontSize: s.lg, lineHeight: 22, fontWeight: w.semibold };
    case 'body':
      return { fontSize: s.base + 1, lineHeight: 21, fontWeight: w.regular };
    case 'label':
      return { fontSize: s.md, lineHeight: 18, fontWeight: w.medium };
    case 'caption':
      return { fontSize: s.sm, lineHeight: 16, fontWeight: w.regular };
    case 'micro':
      return { fontSize: s.xs, lineHeight: 14, fontWeight: w.medium };
  }
}

export function toneColor(t: AppTheme, tone: TextTone): string {
  switch (tone) {
    case 'default':
      return t.colors.text;
    case 'muted':
      return t.colors.textMuted;
    case 'faint':
      return t.colors.textFaint;
    case 'brand':
      return t.colors.brand;
    case 'up':
      return t.colors.up;
    case 'down':
      return t.colors.down;
    case 'warn':
      return t.colors.warn;
    case 'info':
      return t.colors.info;
    case 'onBrand':
      return t.colors.onBrand;
  }
}

/** Themed text with typographic variants. */
export function Txt({
  variant = 'body',
  tone = 'default',
  color,
  weight,
  align,
  numeric,
  mono,
  style,
  ...rest
}: TxtProps) {
  const t = useTheme();
  return (
    <Text
      {...rest}
      style={[
        variantStyle(t, variant),
        { color: color ?? toneColor(t, tone) },
        weight ? { fontWeight: t.fontWeight[weight] } : null,
        align ? { textAlign: align } : null,
        numeric ? { fontVariant: ['tabular-nums'] } : null,
        mono ? { fontFamily: t.monoFamily } : null,
        style,
      ]}
    />
  );
}
