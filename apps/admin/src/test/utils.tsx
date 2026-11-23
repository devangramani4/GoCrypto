import type { GoCryptoClient } from '@gocrypto/api-client';
import { ALL_PERMISSIONS, type Permission, type UserRole } from '@gocrypto/shared-types';
import { ToastProvider } from '@gocrypto/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { ApiProvider } from '../lib/ApiContext';
import { createQueryClient } from '../lib/queryClient';
import { resetSession, useSession } from '../lib/session';

export interface MockParts {
  auth?: Partial<GoCryptoClient['auth']>;
  admin?: Partial<GoCryptoClient['admin']>;
  users?: Partial<GoCryptoClient['users']>;
  assets?: Partial<GoCryptoClient['assets']>;
  markets?: Partial<GoCryptoClient['markets']>;
  options?: Partial<GoCryptoClient['options']>;
}

/**
 * Namespaced mock: provided methods are used as-is; anything else rejects loudly so an unexpected
 * network call shows up as an error state instead of silently hitting a real server.
 */
function namespace<T extends object>(name: string, impl: Partial<T> = {}): T {
  return new Proxy(impl, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return vi.fn(() => Promise.reject(new Error(`client.${name}.${prop} is not mocked`)));
    },
  }) as T;
}

export function createMockClient(parts: MockParts = {}): GoCryptoClient {
  return {
    auth: namespace('auth', parts.auth),
    admin: namespace('admin', parts.admin),
    users: namespace('users', parts.users),
    assets: namespace('assets', parts.assets),
    markets: namespace('markets', parts.markets),
    options: namespace('options', parts.options),
    http: { setTokens: vi.fn(async () => undefined) },
  } as unknown as GoCryptoClient;
}

export function signInAs(role: UserRole, permissions: readonly Permission[] = ALL_PERMISSIONS, userId = '1'): void {
  useSession.setState({ status: 'authenticated', admin: { userId, role, permissions: [...permissions] }, notice: null });
}

export function signedOut(): void {
  resetSession();
  useSession.setState({ status: 'anonymous' });
}

export function renderWithProviders(
  ui: ReactElement,
  { client = createMockClient(), route = '/' }: { client?: GoCryptoClient; route?: string } = {},
): RenderResult & { client: GoCryptoClient; queryClient: QueryClient } {
  const queryClient = createQueryClient({ retry: false });
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <ApiProvider client={client}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{ui}</ToastProvider>
        </QueryClientProvider>
      </ApiProvider>
    </MemoryRouter>,
  );
  return { ...result, client, queryClient };
}
