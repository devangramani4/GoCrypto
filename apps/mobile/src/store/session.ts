import type { UserDto } from '@gocrypto/shared-types';
import { create } from 'zustand';
import { api, authEvents, initDevice, tokenStore } from '../lib/api';
import { isApiError } from '../lib/errors';
import { queryClient } from '../lib/queryClient';
import { onRealtimeSessionRevoked } from '../lib/realtime';
import { useLock } from './lock';
import { settingsHydrated, useSettings } from './settings';

export type SessionStatus = 'booting' | 'signedOut' | 'signedIn';

interface SignOutOptions {
  /** Revoke the session on the server (default). `false` only clears local state. */
  remote?: boolean;
  /** Message shown on the sign-in screen afterwards. */
  notice?: string;
}

interface SessionState {
  status: SessionStatus;
  /** Null while signed out, or when the profile could not be loaded yet (offline start). */
  user: UserDto | null;
  notice: string | null;
  bootstrap: () => Promise<void>;
  completeSignIn: (user: UserDto) => void;
  setUser: (user: UserDto) => void;
  signOut: (opts?: SignOutOptions) => Promise<void>;
  clearNotice: () => void;
}

let bootstrapping: Promise<void> | null = null;

function lockIfEnabled(): void {
  if (useSettings.getState().biometricLock) useLock.getState().lock();
}

export const useSession = create<SessionState>()((set, get) => ({
  status: 'booting',
  user: null,
  notice: null,

  bootstrap: () => {
    bootstrapping ??= (async () => {
      // The persisted device id must be in place before the first API request.
      await Promise.all([settingsHydrated(), initDevice()]);
      const tokens = await tokenStore.get();
      if (!tokens || tokens.refreshTokenExpiresAt <= Date.now()) {
        if (tokens) await api.http.setTokens(null);
        set({ status: 'signedOut', user: null });
        return;
      }
      try {
        const user = await api.users.me();
        lockIfEnabled();
        set({ status: 'signedIn', user });
      } catch (e) {
        if (isApiError(e) && (e.status === 401 || e.status === 403)) {
          await api.http.setTokens(null);
          set({ status: 'signedOut', user: null });
        } else {
          // Offline or API down: keep the stored session; the profile is fetched once reachable.
          lockIfEnabled();
          set({ status: 'signedIn', user: null });
        }
      }
    })();
    return bootstrapping;
  },

  completeSignIn: (user) => {
    useLock.getState().unlock();
    set({ status: 'signedIn', user, notice: null });
  },

  setUser: (user) => {
    if (get().status === 'signedIn') set({ user });
  },

  signOut: async ({ remote = true, notice }: SignOutOptions = {}) => {
    if (remote) {
      try {
        // Stop pushes to this install before the session ends (the server also detaches tokens of
        // devices that no longer have a live session).
        await api.auth.unregisterPushToken().catch(() => undefined);
        await api.auth.logout();
      } catch {
        // The client clears local tokens in a `finally`; a failed server call must not block logout.
      }
    } else {
      await api.http.setTokens(null);
    }
    useLock.getState().unlock();
    set({ status: 'signedOut', user: null, notice: notice ?? null });
    // Drop every cached private query after the signed-in screens unmounted.
    setTimeout(() => queryClient.clear(), 0);
  },

  clearNotice: () => set({ notice: null }),
}));

// Involuntary sign-outs: refresh token expired/reused, or the session was revoked elsewhere.
authEvents.onSessionExpired(() => {
  if (useSession.getState().status === 'signedIn') {
    void useSession.getState().signOut({ remote: false, notice: 'Your session has expired. Please sign in again.' });
  }
});

onRealtimeSessionRevoked(() => {
  if (useSession.getState().status === 'signedIn') {
    void useSession.getState().signOut({ remote: false, notice: 'This session was signed out from another device.' });
  }
});
