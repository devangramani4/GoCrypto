import { darkColors, lightColors, radius, space, typography, type ThemeColors } from '@gocrypto/ui/tokens';
import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from '@react-navigation/native';
import { Platform, StyleSheet } from 'react-native';

export type ColorScheme = 'dark' | 'light';

export interface AppColors extends ThemeColors {
  /** Foreground on filled buy/sell/brand buttons. */
  onTrade: string;
  /** Skeleton placeholder fill. */
  skeleton: string;
  /** Translucent depth-bar fills for the order book. */
  upDepth: string;
  downDepth: string;
}

/** RN wants string font weights; values mirror the design-token weights. */
const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export interface AppTheme {
  scheme: ColorScheme;
  dark: boolean;
  colors: AppColors;
  fontSize: typeof typography.size;
  fontWeight: typeof fontWeight;
  monoFamily: string;
  radius: typeof radius;
  space: typeof space;
  hairline: number;
  navigation: NavigationTheme;
}

function build(scheme: ColorScheme): AppTheme {
  const dark = scheme === 'dark';
  const base = dark ? darkColors : lightColors;
  const colors: AppColors = {
    ...base,
    onTrade: '#FFFFFF',
    skeleton: dark ? '#1A2029' : '#E4E9F0',
    upDepth: dark ? 'rgba(34, 195, 142, 0.16)' : 'rgba(15, 165, 114, 0.12)',
    downDepth: dark ? 'rgba(245, 71, 95, 0.16)' : 'rgba(222, 59, 84, 0.12)',
  };
  const nav = dark ? DarkTheme : DefaultTheme;
  return {
    scheme,
    dark,
    colors,
    fontSize: typography.size,
    fontWeight,
    monoFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    radius,
    space,
    hairline: StyleSheet.hairlineWidth,
    navigation: {
      ...nav,
      dark,
      colors: {
        ...nav.colors,
        primary: base.brand,
        background: base.bg,
        card: base.surface,
        text: base.text,
        border: base.border,
        notification: base.down,
      },
    },
  };
}

export const themes: Record<ColorScheme, AppTheme> = { dark: build('dark'), light: build('light') };
