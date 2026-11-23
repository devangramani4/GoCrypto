import { QueryClient, focusManager, type QueryKey } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { isApiError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        // Client errors are final (validation, auth, not found); retry transient failures only.
        if (
          isApiError(error) &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        ) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

// React Native has no window focus events: refetch stale queries when the app returns to the foreground.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => sub.remove();
});

/**
 * Coalesces bursts of cache invalidations (e.g. a dozen fills arriving at once over the socket)
 * into a single refetch per query prefix.
 */
export function createBatchedInvalidator(client: QueryClient, delayMs = 300) {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const keys = [...pending.values()];
    pending.clear();
    for (const queryKey of keys) void client.invalidateQueries({ queryKey });
  };
  const invalidate = (queryKey: QueryKey) => {
    pending.set(JSON.stringify(queryKey), queryKey);
    timer ??= setTimeout(flush, delayMs);
  };
  invalidate.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending.clear();
  };
  return invalidate;
}
