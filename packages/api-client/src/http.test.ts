import { describe, expect, it, vi } from 'vitest';
import { ApiError, HttpClient, MemoryTokenStore } from './http';

const tokens = (access: string, exp = Date.now() + 600_000) => ({
  accessToken: access,
  refreshToken: `r-${access}`,
  accessTokenExpiresAt: exp,
  refreshTokenExpiresAt: Date.now() + 86_400_000,
  sessionId: 's1',
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('HttpClient', () => {
  it('sends device headers and bearer token', async () => {
    const store = new MemoryTokenStore();
    store.set(tokens('a1'));
    const fetchImpl = vi.fn(async () => json(200, { ok: true }));
    const http = new HttpClient({ baseUrl: 'http://x', tokenStore: store, platform: 'IOS', deviceId: 'dev-123', fetchImpl });
    await http.request('GET', '/api/v1/users/me', { query: { a: 1, b: undefined } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://x/api/v1/users/me?a=1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer a1');
    expect((init.headers as Record<string, string>)['x-platform']).toBe('IOS');
  });

  it('refreshes once for concurrent 401 TOKEN_EXPIRED responses and retries', async () => {
    const store = new MemoryTokenStore();
    store.set(tokens('old'));
    let refreshCalls = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return json(200, tokens('new'));
      }
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === 'Bearer new' ? json(200, { ok: true }) : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    });
    const http = new HttpClient({ baseUrl: '', tokenStore: store, platform: 'WEB', deviceId: 'd', fetchImpl: fetchImpl as never });
    const results = await Promise.all([1, 2, 3].map(() => http.request<{ ok: boolean }>('GET', '/x')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(store.get()?.accessToken).toBe('new');
  });

  it('maps error envelopes to ApiError with field errors', async () => {
    const fetchImpl = vi.fn(async () =>
      json(400, { error: { code: 'VALIDATION_ERROR', message: 'bad', details: [{ path: '/price', message: 'Price is required' }] }, requestId: 'r1' }),
    );
    const http = new HttpClient({ baseUrl: '', tokenStore: new MemoryTokenStore(), platform: 'WEB', deviceId: 'd', fetchImpl });
    const err = await http.request('POST', '/x', { body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_ERROR');
    expect((err as ApiError).fieldErrors()).toEqual({ price: 'Price is required' });
  });

  it('clears the session when the refresh token is rejected', async () => {
    const store = new MemoryTokenStore();
    store.set(tokens('old'));
    const expired = vi.fn();
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh') ? json(401, { error: { code: 'TOKEN_REVOKED', message: 'no' } }) : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'x' } }),
    );
    const http = new HttpClient({ baseUrl: '', tokenStore: store, platform: 'WEB', deviceId: 'd', fetchImpl: fetchImpl as never, onSessionExpired: expired });
    await expect(http.request('GET', '/x')).rejects.toBeInstanceOf(ApiError);
    expect(store.get()).toBeNull();
    expect(expired).toHaveBeenCalled();
  });
});
