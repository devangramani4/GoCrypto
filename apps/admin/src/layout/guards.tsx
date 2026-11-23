import { Logo, Spinner } from '@gocrypto/ui';
import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Forbidden } from '../components/feedback';
import { useApi } from '../lib/ApiContext';
import { NotStaffError, restoreSession } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { type PermissionRequirement, useCan, usePermissions } from '../lib/permissions';
import { useSession } from '../lib/session';
import { firstAllowedPath } from '../navigation';

export function Splash({ label = 'Restoring session…' }: { label?: string }) {
  return (
    <div className="adm-splash">
      <div className="adm-splash__inner">
        <Logo size={34} />
        <div className="row">
          <Spinner size={14} />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

/** Resumes a session from the refresh cookie once on start-up before any route renders. */
export function SessionBootstrap({ children }: { children: ReactNode }) {
  const client = useApi();
  const status = useSession((s) => s.status);

  useEffect(() => {
    if (useSession.getState().status !== 'restoring') return;
    let cancelled = false;
    restoreSession(client).then(
      (admin) => {
        if (cancelled) return;
        if (admin) useSession.getState().signIn(admin);
        else useSession.getState().signOut();
      },
      (e: unknown) => {
        if (cancelled) return;
        useSession.getState().signOut({
          tone: 'error',
          message: e instanceof NotStaffError ? e.message : `We couldn’t verify your back-office access: ${errorMessage(e)}`,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (status === 'restoring') return <Splash />;
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

export function RequirePermission({ perm, children }: { perm: PermissionRequirement; children: ReactNode }) {
  const can = useCan();
  return can(perm) ? <>{children}</> : <Forbidden perm={perm} />;
}

export function HomeRedirect() {
  const perms = usePermissions();
  const path = firstAllowedPath(perms);
  return path ? <Navigate to={path} replace /> : <Forbidden title="Your role has no back-office permissions yet" />;
}
