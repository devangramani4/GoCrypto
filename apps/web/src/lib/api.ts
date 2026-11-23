import { ApiError, GoCryptoClient, MemoryTokenStore, RealtimeClient, type TokenStore } from '@gocrypto/api-client';
import type { AuthTokens } from '@gocrypto/shared-types';
import { QueryClient } from '@tanstack/react-query';
import { deviceId, deviceName, isDesktop } from './env';

/**
 * Desktop: tokens persisted through the Electron preload bridge (OS keychain via safeStorage).
 * Web: access token in memory only; the refresh token lives in an httpOnly SameSite=Strict cookie.
 */
class DesktopTokenStore implements TokenStore {
  private cache: AuthTokens | null = null;
  private loaded = false;
  async get(): Promise<AuthTokens | null> {
    if (!this.loaded) {
      const raw = await window.gocryptoDesktop!.secureStore.get('auth');
      this.cache = raw ? (JSON.parse(raw) as AuthTokens) : null;
      this.loaded = true;
    }
    return this.cache;
  }
  async set(tokens: AuthTokens | null): Promise<void> {
    this.cache = tokens;
    this.loaded = true;
    await window.gocryptoDesktop!.secureStore.set('auth', tokens ? JSON.stringify(tokens) : null);
  }
}

type SessionListener = (tokens: AuthTokens | null) => void;
const sessionListeners = new Set<SessionListener>();
export function onTokensChanged(l: SessionListener): () => void {
  sessionListeners.add(l);
  return () => sessionListeners.delete(l);
}

let expiredHandler: () => void = () => undefined;
export function setSessionExpiredHandler(fn: () => void): void {
  expiredHandler = fn;
}

export let api: GoCryptoClient;
export let realtime: RealtimeClient;

export function initClients(endpoints: { apiUrl: string; wsUrl: string }): void {
  const tokenStore: TokenStore = isDesktop ? new DesktopTokenStore() : new MemoryTokenStore();
  api = new GoCryptoClient({
    baseUrl: endpoints.apiUrl,
    tokenStore,
    platform: isDesktop ? 'DESKTOP' : 'WEB',
    deviceId: deviceId(),
    deviceName: deviceName(),
    cookieRefresh: !isDesktop,
    onTokens: (t) => {
      for (const l of sessionListeners) l(t);
      void realtime?.refreshAuth();
    },
    onSessionExpired: () => expiredHandler(),
  });
  realtime = new RealtimeClient({
    url: endpoints.wsUrl,
    path: '/socket.io',
    getToken: async () => (await api.http.getTokens())?.accessToken ?? null,
    onSessionRevoked: () => expiredHandler(),
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

/** Human message for an error (server messages are already user-facing). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
