import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_FUTURES_SYMBOL, DEFAULT_SPOT_SYMBOL } from '../config';
import { SECURE_KEYS, secureStateStorage } from '../lib/secureStorage';

export type ThemeMode = 'system' | 'dark' | 'light';

interface SettingsState {
  themeMode: ThemeMode;
  /** Require Face ID / Touch ID / fingerprint (or device passcode) on launch and on return to foreground. */
  biometricLock: boolean;
  favorites: string[];
  lastSpotSymbol: string;
  lastFuturesSymbol: string;
  hideBalances: boolean;

  setThemeMode: (mode: ThemeMode) => void;
  setBiometricLock: (enabled: boolean) => void;
  toggleFavorite: (symbol: string) => void;
  setLastSpotSymbol: (symbol: string) => void;
  setLastFuturesSymbol: (symbol: string) => void;
  toggleHideBalances: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      biometricLock: false,
      favorites: ['BTCUSDT', 'ETHUSDT', 'BTCUSDT-PERP'],
      lastSpotSymbol: DEFAULT_SPOT_SYMBOL,
      lastFuturesSymbol: DEFAULT_FUTURES_SYMBOL,
      hideBalances: false,

      setThemeMode: (themeMode) => set({ themeMode }),
      setBiometricLock: (biometricLock) => set({ biometricLock }),
      toggleFavorite: (symbol) =>
        set((s) => ({
          favorites: s.favorites.includes(symbol)
            ? s.favorites.filter((f) => f !== symbol)
            : [...s.favorites, symbol].slice(-40),
        })),
      setLastSpotSymbol: (lastSpotSymbol) => set({ lastSpotSymbol }),
      setLastFuturesSymbol: (lastFuturesSymbol) => set({ lastFuturesSymbol }),
      toggleHideBalances: () => set((s) => ({ hideBalances: !s.hideBalances })),
    }),
    {
      name: SECURE_KEYS.settings,
      version: 1,
      storage: createJSONStorage(() => secureStateStorage),
      partialize: (s) => ({
        themeMode: s.themeMode,
        biometricLock: s.biometricLock,
        favorites: s.favorites,
        lastSpotSymbol: s.lastSpotSymbol,
        lastFuturesSymbol: s.lastFuturesSymbol,
        hideBalances: s.hideBalances,
      }),
    },
  ),
);

function subscribeHydration(onChange: () => void): () => void {
  return useSettings.persist.onFinishHydration(() => onChange());
}

/** True once persisted preferences have been read from secure storage. */
export function useSettingsHydrated(): boolean {
  return useSyncExternalStore(subscribeHydration, () => useSettings.persist.hasHydrated());
}

/** Resolves when persisted preferences are available (used by the session bootstrap). */
export function settingsHydrated(): Promise<void> {
  if (useSettings.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useSettings.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}
