import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError, isUnauthorized } from './errors';

/**
 * Shared TanStack Query configuration. A 401 that survives the client's transparent token refresh
 * means the session is gone: `onUnauthorized` routes the admin back to the login screen.
 */
export function createQueryClient(opts: { onUnauthorized?: () => void; retry?: boolean } = {}): QueryClient {
  const onError = (e: unknown) => {
    if (isUnauthorized(e)) opts.onUnauthorized?.();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // Client errors (403 missing permission, 404, validation) will not succeed on retry.
        retry: opts.retry === false ? false : (failureCount, e) => !(isApiError(e) && e.status >= 400 && e.status < 500) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  });
}
