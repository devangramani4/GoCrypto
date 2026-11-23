import type { ApiErrorBody, AuthTokens, ErrorCode, Platform } from '@gocrypto/shared-types';

export interface TokenStore {
  get(): AuthTokens | null | Promise<AuthTokens | null>;
  set(tokens: AuthTokens | null): void | Promise<void>;
}

/** In-memory store (web keeps the access token in memory; the refresh token lives in an httpOnly cookie). */
export class MemoryTokenStore implements TokenStore {
  private tokens: AuthTokens | null = null;
  get(): AuthTokens | null {
    return this.tokens;
  }
  set(tokens: AuthTokens | null): void {
    this.tokens = tokens;
  }
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: Partial<ApiErrorBody> | null, fallback = 'Request failed') {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = (body?.error?.code ?? (status === 0 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR')) as ErrorCode;
    this.details = body?.error?.details;
    this.requestId = body?.requestId;
  }

  /** Field-level messages from server-side validation (for forms). */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as { path?: string; message?: string }[]) {
        const key = (d.path ?? '').replace(/^\//, '').replace(/\//g, '.') || '_';
        if (d.message && !out[key]) out[key] = d.message;
      }
    }
    return out;
  }
}

export interface HttpOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  platform: Platform;
  deviceId: string;
  deviceName?: string;
  /** Web: refresh token travels in an httpOnly cookie instead of the response body. */
  cookieRefresh?: boolean;
  onTokens?: (tokens: AuthTokens | null) => void;
  onSessionExpired?: () => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const AUTH_RETRY_CODES = new Set<ErrorCode>(['TOKEN_EXPIRED', 'TOKEN_INVALID']);

/** Low-level HTTP transport with transparent, single-flight access-token refresh. */
export class HttpClient {
  private refreshing: Promise<AuthTokens | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(readonly opts: HttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const q = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return `${this.opts.baseUrl}${path}${q ? `?${q}` : ''}`;
  }

  private headers(token: string | null, extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: 'application/json',
      'x-platform': this.opts.platform,
      'x-device-id': this.opts.deviceId,
      ...(this.opts.deviceName ? { 'x-device-name': this.opts.deviceName } : {}),
      ...(this.opts.cookieRefresh ? { 'x-gc-client': 'web' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async setTokens(tokens: AuthTokens | null): Promise<void> {
    await this.opts.tokenStore.set(tokens);
    this.opts.onTokens?.(tokens);
  }

  async getTokens(): Promise<AuthTokens | null> {
    return this.opts.tokenStore.get();
  }

  /** Refresh the access token once even if many requests need it concurrently. */
  refresh(): Promise<AuthTokens | null> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const current = await this.getTokens();
      const body = current?.refreshToken ? { refreshToken: current.refreshToken } : {};
      if (!current?.refreshToken && !this.opts.cookieRefresh) return null;
      try {
        const res = await this.fetchImpl(this.url('/api/v1/auth/refresh'), {
          method: 'POST',
          headers: this.headers(null, { 'content-type': 'application/json' }),
          body: JSON.stringify(body),
          credentials: this.opts.cookieRefresh ? 'include' : 'same-origin',
        });
        if (!res.ok) {
          // A concurrent tab may have rotated the token (409): re-read the store once.
          if (res.status === 409) {
            const again = await this.getTokens();
            if (again && again.accessTokenExpiresAt > Date.now() + 5_000) return again;
          }
          await this.setTokens(null);
          this.opts.onSessionExpired?.();
          return null;
        }
        const tokens = (await res.json()) as AuthTokens;
        await this.setTokens(tokens);
        return tokens;
      } catch {
        return null;
      } finally {
        setTimeout(() => (this.refreshing = null), 0);
      }
    })();
    return this.refreshing;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth !== false;
    let tokens = auth ? await this.getTokens() : null;
    if (auth && tokens && tokens.accessTokenExpiresAt - Date.now() < 15_000) tokens = (await this.refresh()) ?? tokens;
    const send = async (token: string | null) => {
      const headers = this.headers(token, {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      });
      return this.fetchImpl(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: this.opts.cookieRefresh ? 'include' : 'same-origin',
        signal: opts.signal,
      });
    };
    let res: Response;
    try {
      res = await send(tokens?.accessToken ?? null);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ApiError(0, null, 'Network error — check your connection');
    }
    if (res.status === 401 && auth) {
      const body = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
      if (body && AUTH_RETRY_CODES.has(body.error.code)) {
        const fresh = await this.refresh();
        if (fresh) res = await send(fresh.accessToken);
      } else if (body && (body.error.code === 'TOKEN_REVOKED' || body.error.code === 'REFRESH_TOKEN_REUSED')) {
        await this.setTokens(null);
        this.opts.onSessionExpired?.();
      }
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody, res.statusText);
    return data as T;
  }
}

/** RFC 4122 v4-ish id for idempotency keys and client order ids (works without crypto.randomUUID). */
/** Unique id for idempotency keys / client order ids (uniqueness matters, not secrecy). */
export function randomId(prefix = ''): string {
  const c = globalThis.crypto as Crypto | undefined;
  let raw: string;
  if (c?.randomUUID) raw = c.randomUUID().replace(/-/g, '');
  else if (c?.getRandomValues) raw = Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  else raw = `${Date.now().toString(16)}${Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
  return `${prefix}${raw}`.slice(0, 36);
}
