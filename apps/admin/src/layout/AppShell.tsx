import { Skeleton } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ErrorBoundary } from '../components/feedback';
import { useApi } from '../lib/ApiContext';
import { NOT_STAFF_MESSAGE, safeLogout } from '../lib/auth';
import { isForbidden } from '../lib/errors';
import { qk } from '../lib/queryKeys';
import { toAdminIdentity, useSession } from '../lib/session';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Role permissions are editable at runtime: re-check them on focus and every few minutes so the
 * navigation and action gating follow changes made by a Super Admin without a re-login.
 */
function usePermissionSync(): void {
  const client = useApi();
  const query = useQuery({
    queryKey: qk.me,
    queryFn: () => client.admin.me(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  useEffect(() => {
    if (!query.data) return;
    const next = toAdminIdentity(query.data);
    const current = useSession.getState().admin;
    if (!current || current.role !== next.role || current.permissions.join() !== next.permissions.join()) useSession.getState().signIn(next);
  }, [query.data]);
  useEffect(() => {
    if (!isForbidden(query.error)) return;
    void safeLogout(client).then(() => useSession.getState().signOut({ tone: 'error', message: NOT_STAFF_MESSAGE }));
  }, [query.error, client]);
}

function PageSkeleton() {
  return (
    <div className="adm-page" aria-busy="true" aria-label="Loading page">
      <Skeleton width={220} height={24} />
      <Skeleton width={360} height={14} />
      <Skeleton height={320} style={{ borderRadius: 10 }} />
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  usePermissionSync();
  return (
    <div className="adm-shell">
      <Sidebar />
      <div className="adm-main">
        <Topbar />
        <main className="adm-content" id="main">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
