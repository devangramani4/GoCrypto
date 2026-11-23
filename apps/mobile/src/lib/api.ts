import { GoCryptoClient, type TokenStore } from '@gocrypto/api-client';
import type { AuthTokens, Platform as ApiPlatform } from '@gocrypto/shared-types';
import { AppState, Platform } from 'react-native';
import { config } from '../config';
import { randomUUID } from './random';
import {
  DEVICE_STORE_OPTIONS,
  SECURE_KEYS,
  TOKEN_STORE_OPTIONS,
  secureDelete,
  secureGet,
  secureSet,
} from './secureStorage';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseTokens(raw: string | null): AuthTokens | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      isRecord(v) &&
      typeof v.accessToken === 'string' &&
      typeof v.refreshToken === 'string' &&
      typeof v.accessTokenExpiresAt === 'number' &&
      typeof v.refreshTokenExpiresAt === 'number' &&
      typeof v.sessionId === 'string'
    ) {
      return {
        accessToken: v.accessToken,
        refreshToken: v.refreshToken,
        accessTokenExpiresAt: v.accessTokenExpiresAt,
        refreshTokenExpiresAt: v.refreshTokenExpiresAt,
        sessionId: v.sessionId,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Keychain/Keystore-backed token store with an in-memory cache, so the secure enclave is only
 * touched on start-up and when tokens rotate (not on every request).
 */
class SecureTokenStore implements TokenStore {
  /** `undefined` = not loaded yet. */
  private cache: AuthTokens | null | undefined = undefined;
  private loading: Promise<AuthTokens | null> | null = null;
  /** Write that could not be persisted yet (keychain unavailable); retried on foreground. */
  private unsaved: AuthTokens | 'delete' | null = null;

  get(): Promise<AuthTokens | null> {
    if (this.cache !== undefined) return Promise.resolve(this.cache);
    if (!this.loading) {
      this.loading = (async () => {
        const raw = await secureGet(SECURE_KEYS.tokens, TOKEN_STORE_OPTIONS);
        const parsed = parseTokens(raw);
        if (raw && !parsed) await secureDelete(SECURE_KEYS.tokens, TOKEN_STORE_OPTIONS);
        // A concurrent set() wins over what was read from disk.
        if (this.cache === undefined) this.cache = parsed;
        return this.cache;
      })().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  /** Never throws: the in-memory copy is authoritative and the keychain write is retried. */
  async set(tokens: AuthTokens | null): Promise<void> {
    // Cookie-style refresh never applies to native; ignore a response without a refresh token so it
    // cannot replace a valid stored session.
    if (tokens && !tokens.refreshToken) return;
    this.cache = tokens;
    this.unsaved = tokens ?? 'delete';
    await this.flush();
  }

  async flush(): Promise<void> {
    const pending = this.unsaved;
    if (pending === null) return;
    try {
      if (pending === 'delete') await secureDelete(SECURE_KEYS.tokens, TOKEN_STORE_OPTIONS);
      else await secureSet(SECURE_KEYS.tokens, JSON.stringify(pending), TOKEN_STORE_OPTIONS);
      if (this.unsaved === pending) this.unsaved = null;
    } catch {
      // Keychain temporarily unavailable — keep `unsaved` for the next attempt.
    }
  }
}

const DEVICE_ID_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

/**
 * Stable per-install id (sent as X-Device-Id). Starts as a fresh id and is replaced by the persisted
 * one in initDevice(), which the session bootstrap awaits before the first request.
 */
let deviceId = `${Platform.OS}-${randomUUID()}`;
let deviceInit: Promise<void> | null = null;

/** Loads the persisted device id, or persists the fresh one. Never throws. */
export function initDevice(): Promise<void> {
  deviceInit ??= (async () => {
    const stored = await secureGet(SECURE_KEYS.deviceId, DEVICE_STORE_OPTIONS);
    if (stored && DEVICE_ID_RE.test(stored)) {
      deviceId = stored;
      return;
    }
    // Persisting failed: the id is still valid for this run.
    await secureSet(SECURE_KEYS.deviceId, deviceId, DEVICE_STORE_OPTIONS).catch(() => undefined);
  })();
  return deviceInit;
}

function capitalize(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * Human-readable device label, e.g. "Google Pixel 9" or "iPhone (iOS 26.1)". HTTP header values must be
 * ASCII (OkHttp rejects anything else).
 */
function loadDeviceName(): string {
  let raw: string;
  if (Platform.OS === 'android') {
    const { Manufacturer = '', Model = '' } = Platform.constants;
    const maker = capitalize(Manufacturer.trim());
    raw = Model.toLowerCase().startsWith(maker.toLowerCase()) ? Model : `${maker} ${Model}`;
  } else if (Platform.OS === 'ios') {
    const { interfaceIdiom, osVersion } = Platform.constants;
    raw = `${interfaceIdiom === 'pad' ? 'iPad' : 'iPhone'} (iOS ${osVersion})`;
  } else {
    raw = 'Mobile device';
  }
  const ascii = raw
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return ascii || (Platform.OS === 'ios' ? 'iPhone' : 'Android device');
}

const platform: ApiPlatform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';

export const device = {
  get id(): string {
    return deviceId;
  },
  name: loadDeviceName(),
  platform,
};

type TokensListener = (tokens: AuthTokens | null) => void;
type Listener = () => void;

const tokenListeners = new Set<TokensListener>();
const expiredListeners = new Set<Listener>();

/** Decoupled hooks so the session store and realtime client can react to auth changes. */
export const authEvents = {
  onTokens(listener: TokensListener): () => void {
    tokenListeners.add(listener);
    return () => {
      tokenListeners.delete(listener);
    };
  },
  onSessionExpired(listener: Listener): () => void {
    expiredListeners.add(listener);
    return () => {
      expiredListeners.delete(listener);
    };
  },
};

export const tokenStore = new SecureTokenStore();

AppState.addEventListener('change', (state) => {
  if (state === 'active') void tokenStore.flush();
});

/** The single API client used by the whole app. */
export const api = new GoCryptoClient({
  baseUrl: config.apiUrl,
  tokenStore,
  platform: device.platform,
  deviceId: () => device.id,
  deviceName: device.name,
  onTokens: (tokens) => {
    for (const l of tokenListeners) l(tokens);
  },
  onSessionExpired: () => {
    for (const l of expiredListeners) l();
  },
});

/** A fresh access token (refreshed when it is about to expire), or null when signed out. */
export async function getFreshAccessToken(): Promise<string | null> {
  const tokens = await tokenStore.get();
  if (!tokens) return null;
  if (tokens.accessTokenExpiresAt - Date.now() < 15_000) {
    const fresh = await api.http.refresh();
    return fresh?.accessToken ?? null;
  }
  return tokens.accessToken;
}

/** Idempotency key / one-off id (32 hex chars) from the platform CSPRNG. */
export function newIdempotencyKey(prefix = ''): string {
  return `${prefix}${randomUUID().replace(/-/g, '')}`;
}
