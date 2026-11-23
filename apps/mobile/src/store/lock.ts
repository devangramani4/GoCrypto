import { create } from 'zustand';

interface LockState {
  /** Biometric lock screen is showing. */
  locked: boolean;
  /** Privacy cover is showing (app inactive / in the app switcher). */
  covered: boolean;
  /** A system authentication prompt is on screen (app is briefly "inactive"). */
  authenticating: boolean;
  lock: () => void;
  unlock: () => void;
  setCovered: (covered: boolean) => void;
  setAuthenticating: (authenticating: boolean) => void;
}

export const useLock = create<LockState>()((set) => ({
  locked: false,
  covered: false,
  authenticating: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
  setCovered: (covered) => set({ covered }),
  setAuthenticating: (authenticating) => set({ authenticating }),
}));

/** Sheets, toasts and other overlays hide while the app is locked or covered. */
export function useObscured(): boolean {
  return useLock((s) => s.locked || s.covered);
}
