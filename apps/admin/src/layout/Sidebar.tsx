import { Icon, IconButton, Logo, cx } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router';
import { RoleBadge } from '../components/cells';
import { useApi } from '../lib/ApiContext';
import { useCan, usePermissions } from '../lib/permissions';
import { qk } from '../lib/queryKeys';
import { useSession } from '../lib/session';
import { useLogout } from '../lib/useLogout';
import { visibleSections } from '../navigation';

/** Work-queue counters shown next to nav items (only for areas the admin can open). */
function useNavCounts(): Record<string, { count: number; tone: 'warn' | 'down' } | undefined> {
  const client = useApi();
  const can = useCan();
  const pendingParams = { status: 'PENDING_REVIEW', page: 1, pageSize: 1 };
  const alertParams = { status: 'OPEN', page: 1, pageSize: 1 };
  const pending = useQuery({
    queryKey: qk.withdrawals(pendingParams),
    queryFn: () => client.admin.withdrawals(pendingParams),
    enabled: can('wallet.read'),
    refetchInterval: 60_000,
    retry: false,
  });
  const alerts = useQuery({
    queryKey: qk.alerts(alertParams),
    queryFn: () => client.admin.alerts(alertParams),
    enabled: can('security.read'),
    refetchInterval: 60_000,
    retry: false,
  });
  return {
    '/wallet': pending.data?.total ? { count: pending.data.total, tone: 'warn' } : undefined,
    '/security': alerts.data?.total ? { count: alerts.data.total, tone: 'down' } : undefined,
  };
}

function initialsOf(text: string): string {
  const words = text.split(/[\s@._-]+/).filter(Boolean);
  const first = words[0]?.[0] ?? 'A';
  const second = words[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}

function SidebarIdentity() {
  const client = useApi();
  const admin = useSession((s) => s.admin);
  const logout = useLogout();
  const [busy, setBusy] = useState(false);
  const profile = useQuery({ queryKey: qk.profile, queryFn: () => client.users.me(), staleTime: 5 * 60_000, retry: false });
  if (!admin) return null;
  const email = profile.data?.email ?? null;
  const label = profile.data?.displayName || email || `Staff #${admin.userId}`;
  return (
    <div className="adm-sidebar__foot">
      <div className="adm-identity">
        <span className="adm-avatar" aria-hidden="true">
          {initialsOf(label)}
        </span>
        <div className="adm-identity__text">
          <span className="adm-identity__email truncate" title={email ?? undefined}>
            {label}
          </span>
          <span>
            <RoleBadge role={admin.role} />
          </span>
        </div>
        <IconButton
          icon="logout"
          label="Sign out"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void logout().finally(() => setBusy(false));
          }}
        />
      </div>
    </div>
  );
}

export function Sidebar() {
  const perms = usePermissions();
  const sections = useMemo(() => visibleSections(perms), [perms]);
  const counts = useNavCounts();
  return (
    <aside className="adm-sidebar">
      <div className="adm-sidebar__brand">
        <Logo size={26} />
        <span className="adm-sidebar__product">Admin</span>
      </div>
      <nav className="adm-nav" aria-label="Main navigation">
        {sections.map((section) => (
          <div key={section.label} className="adm-nav__group" role="group" aria-label={section.label}>
            <div className="adm-nav__label">{section.label}</div>
            {section.items.map((item) => {
              const badge = counts[item.path];
              return (
                <NavLink key={item.path} to={item.path} className="adm-nav__link">
                  <Icon name={item.icon} size={16} />
                  <span>{item.label}</span>
                  {badge && (
                    <span className={cx('adm-nav__count', badge.tone === 'down' && 'adm-nav__count--down')} aria-label={`${badge.count} pending`}>
                      {badge.count > 99 ? '99+' : badge.count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <SidebarIdentity />
    </aside>
  );
}
