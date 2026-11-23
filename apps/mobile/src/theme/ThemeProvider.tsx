import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useSettings } from '../store/settings';
import { themes, type AppTheme, type ColorScheme } from './theme';

const ThemeContext = createContext<AppTheme>(themes.dark);

/** Resolves the active scheme from the user's choice (system / dark / light). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useSettings((s) => s.themeMode);
  const system = useColorScheme();
  const scheme: ColorScheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  const theme = themes[scheme];
  // The native window/root view backgrounds are the brand dark (styles.xml, SceneDelegate.swift), and
  // the app's root View paints theme.colors.bg on top.
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Theme-aware style factory: `const useStyles = makeStyles((t) => ({ … }))`, then `useStyles()` in
 * the component. Styles are computed once per color scheme.
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (theme: AppTheme) => T): () => T {
  const cache = new Map<ColorScheme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme.scheme);
    if (!styles) {
      styles = factory(theme);
      cache.set(theme.scheme, styles);
    }
    return styles;
  };
}
