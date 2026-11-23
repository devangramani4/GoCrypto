/**
 * GoCrypto design tokens. Plain data so they can be used by the web stylesheet (CSS variables),
 * Electron and React Native (StyleSheet) alike.
 */

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  raised: string;
  hover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  brand: string;
  brandHover: string;
  brandSoft: string;
  onBrand: string;
  up: string;
  upSoft: string;
  down: string;
  downSoft: string;
  warn: string;
  warnSoft: string;
  info: string;
  focus: string;
  overlay: string;
  chartGrid: string;
}

export const darkColors: ThemeColors = {
  bg: '#0A0D12',
  surface: '#10141B',
  surfaceAlt: '#0D1117',
  raised: '#161B24',
  hover: '#1C2230',
  border: '#1F2632',
  borderStrong: '#2C3442',
  text: '#E7EAF0',
  textMuted: '#8B95A7',
  textFaint: '#5D6678',
  // Logo blue (brand.ts). Light enough to read as text on the dark background.
  brand: '#2D7BF6',
  brandHover: '#4A8EF8',
  brandSoft: 'rgba(45, 123, 246, 0.14)',
  onBrand: '#FFFFFF',
  up: '#22C38E',
  upSoft: 'rgba(34, 195, 142, 0.14)',
  down: '#F5475F',
  downSoft: 'rgba(245, 71, 95, 0.14)',
  warn: '#F5B544',
  warnSoft: 'rgba(245, 181, 68, 0.14)',
  info: '#38BDF8',
  focus: '#4A8EF8',
  overlay: 'rgba(3, 5, 9, 0.72)',
  chartGrid: 'rgba(139, 149, 167, 0.08)',
};

export const lightColors: ThemeColors = {
  bg: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  raised: '#F1F4F9',
  hover: '#EAEFF6',
  border: '#E3E8EF',
  borderStrong: '#CBD3DF',
  text: '#121721',
  textMuted: '#5B6577',
  textFaint: '#8E98AA',
  // A shade deeper than the logo blue so white button text and blue links keep 4.5:1 contrast.
  brand: '#2268E8',
  brandHover: '#1B57CC',
  brandSoft: 'rgba(34, 104, 232, 0.10)',
  onBrand: '#FFFFFF',
  up: '#0FA572',
  upSoft: 'rgba(15, 165, 114, 0.10)',
  down: '#DE3B54',
  downSoft: 'rgba(222, 59, 84, 0.10)',
  warn: '#C98A12',
  warnSoft: 'rgba(201, 138, 18, 0.12)',
  info: '#0284C7',
  focus: '#2268E8',
  overlay: 'rgba(15, 23, 42, 0.45)',
  chartGrid: 'rgba(91, 101, 119, 0.10)',
};

export const typography = {
  fontFamily: "'Inter', 'SF Pro Text', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  monoFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace",
  size: { xs: 11, sm: 12, md: 13, base: 14, lg: 16, xl: 20, xxl: 24, display: 32 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const radius = { xs: 3, sm: 4, md: 6, lg: 10, xl: 14, pill: 999 } as const;
export const space = (n: number): number => n * 4;

export type ThemeName = 'dark' | 'light';
export const themes: Record<ThemeName, ThemeColors> = { dark: darkColors, light: lightColors };

/** CSS custom properties for a theme (web / Electron). */
export function cssVariables(colors: ThemeColors): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors)) out[`--c-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`] = v;
  return out;
}
