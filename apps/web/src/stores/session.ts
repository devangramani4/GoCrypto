import type { UserDto } from '@gocrypto/shared-types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Status = 'unknown' | 'authenticated' | 'anonymous';

interface SessionState {
  status: Status;
  user: UserDto | null;
  setUser: (user: UserDto | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'unknown',
  user: null,
  setUser: (user) => set({ user, status: user ? 'authenticated' : 'anonymous' }),
}));

export type ThemeMode = 'dark' | 'light';

interface PrefsState {
  theme: ThemeMode;
  favorites: string[];
  proLayout: boolean;
  orderBookStep: Record<string, string>;
  lastSpot: string;
  lastFutures: string;
  confirmOrders: boolean;
  hideSmallBalances: boolean;
  setTheme: (t: ThemeMode) => void;
  toggleFavorite: (symbol: string) => void;
  setProLayout: (v: boolean) => void;
  setBookStep: (symbol: string, step: string) => void;
  setLast: (kind: 'spot' | 'futures', symbol: string) => void;
  setConfirmOrders: (v: boolean) => void;
  setHideSmall: (v: boolean) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      favorites: ['BTCUSDT', 'ETHUSDT', 'BTCUSDT-PERP'],
      proLayout: false,
      orderBookStep: {},
      lastSpot: 'BTCUSDT',
      lastFutures: 'BTCUSDT-PERP',
      confirmOrders: true,
      hideSmallBalances: false,
      setTheme: (theme) => set({ theme }),
      toggleFavorite: (symbol) =>
        set((s) => ({ favorites: s.favorites.includes(symbol) ? s.favorites.filter((x) => x !== symbol) : [...s.favorites, symbol] })),
      setProLayout: (proLayout) => set({ proLayout }),
      setBookStep: (symbol, step) => set((s) => ({ orderBookStep: { ...s.orderBookStep, [symbol]: step } })),
      setLast: (kind, symbol) => set(kind === 'spot' ? { lastSpot: symbol } : { lastFutures: symbol }),
      setConfirmOrders: (confirmOrders) => set({ confirmOrders }),
      setHideSmall: (hideSmallBalances) => set({ hideSmallBalances }),
    }),
    { name: 'gc.prefs' },
  ),
);
