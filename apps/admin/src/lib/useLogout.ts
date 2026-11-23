import { useCallback } from 'react';
import { useApi } from './ApiContext';
import { safeLogout } from './auth';
import { useSession } from './session';

/**
 * Revoke the session server-side and return to the login screen. The query cache is cleared by the
 * login screen once the protected pages have unmounted, so no data from this session survives.
 */
export function useLogout(): () => Promise<void> {
  const client = useApi();
  const signOut = useSession((s) => s.signOut);
  return useCallback(async () => {
    await safeLogout(client);
    signOut({ tone: 'info', message: 'You have been signed out.' });
  }, [client, signOut]);
}
