import type { AdminUserDetailDto } from '@gocrypto/shared-types';
import { Alert, Badge, Button, EmptyState, ErrorState, KeyValue, Skeleton, Tabs } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeader, Panel } from '../../components/PageHeader';
import { DateTime, FlagBadge, Mono, RoleBadge, StatusBadge } from '../../components/cells';
import { useApi } from '../../lib/ApiContext';
import { errorMessage, isApiError } from '../../lib/errors';
import { fmtInt, fmtRelative } from '../../lib/format';
import { useSearchState } from '../../lib/hooks';
import { type PermissionRequirement, useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { USER_STATUS_TONE } from '../../lib/status';
import { UserControls } from './UserControls';
import { UserFeesTab } from './UserFeesTab';
import { BalancesTab, DevicesTab, LedgerTab, LoginsTab, OrdersTab, SessionsTab } from './UserTabs';

type TabKey = 'balances' | 'orders' | 'ledger' | 'sessions' | 'devices' | 'logins' | 'fees';

interface TabDef {
  value: TabKey;
  label: string;
  perm?: PermissionRequirement;
  count?: (u: AdminUserDetailDto) => number;
  render: (u: AdminUserDetailDto) => ReactNode;
}

const TABS: TabDef[] = [
  { value: 'balances', label: 'Balances', count: (u) => u.balances.length, render: (u) => <BalancesTab user={u} /> },
  { value: 'orders', label: 'Orders', perm: 'orders.read', count: (u) => u.openOrders, render: (u) => <OrdersTab user={u} /> },
  { value: 'ledger', label: 'Ledger', perm: 'wallet.read', render: (u) => <LedgerTab user={u} /> },
  { value: 'sessions', label: 'Sessions', count: (u) => u.sessions.length, render: (u) => <SessionsTab user={u} /> },
  { value: 'devices', label: 'Devices', count: (u) => u.devices.length, render: (u) => <DevicesTab user={u} /> },
  { value: 'logins', label: 'Sign-ins', render: (u) => <LoginsTab user={u} /> },
  { value: 'fees', label: 'Fee overrides', perm: 'fees.read', render: (u) => <UserFeesTab user={u} /> },
];

function ProfileCard({ user }: { user: AdminUserDetailDto }) {
  const items: [ReactNode, ReactNode][] = [
    ['Email', user.emailVerified ? <Badge tone="up">Verified</Badge> : <Badge tone="warn">Unverified</Badge>],
    ['Phone', user.phone ?? <span className="faint">Not set</span>],
    ['Two-factor auth', <FlagBadge key="2fa" on={user.twoFactorEnabled} offTone="warn" />],
    ['Trading PIN', user.hasTradingPin ? <Badge tone="up">Set</Badge> : <Badge>Not set</Badge>],
    ['Trading', <FlagBadge key="t" on={user.tradingEnabled} />],
    ['Withdrawals', <FlagBadge key="w" on={user.withdrawalsEnabled} />],
    ['KYC level', <span className="num">L{user.kycLevel}</span>],
    ['VIP tier', <span className="num">{user.vipTier}</span>],
    ['Open orders', <span className="num">{fmtInt(user.openOrders)}</span>],
    ['Open positions', <span className="num">{fmtInt(user.openPositions)}</span>],
    ['Created', <DateTime key="c" value={user.createdAt} />],
    ['Last sign-in', user.lastLoginAt ? <span title={String(new Date(user.lastLoginAt).toISOString())}>{fmtRelative(user.lastLoginAt)}</span> : <span className="faint">Never</span>],
  ];
  return (
    <Panel title="Profile & flags">
      <div className="adm-panel__body adm-kv-card" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <KeyValue items={items} />
      </div>
    </Panel>
  );
}

function DetailSkeleton() {
  return (
    <div className="adm-page" aria-busy="true" aria-label="Loading user">
      <Skeleton width={120} height={12} />
      <Skeleton width={340} height={24} />
      <div className="adm-detail">
        <Skeleton height={420} style={{ borderRadius: 10 }} />
        <Skeleton height={420} style={{ borderRadius: 10 }} />
      </div>
    </div>
  );
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const client = useApi();
  const can = useCan();
  const validId = /^\d{1,20}$/.test(id);
  const query = useQuery({ queryKey: qk.user(id), queryFn: () => client.admin.user(id), enabled: validId });
  const tabs = TABS.filter((t) => can(t.perm));
  const [s, set] = useSearchState({ tab: 'balances' });
  const active = tabs.find((t) => t.value === s.tab) ?? tabs[0];

  if (!validId || isApiError(query.error, { status: 404 })) {
    return (
      <div className="adm-page">
        <PageHeader back={{ to: '/users', label: 'Users' }} title="User not found" />
        <div className="adm-panel">
          <EmptyState icon="user" title="No user with this id" description={`“${id}” does not match any account.`} action={<Link to="/users">Back to users</Link>} />
        </div>
      </div>
    );
  }
  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <div className="adm-page">
        <PageHeader back={{ to: '/users', label: 'Users' }} title={`User #${id}`} />
        <div className="adm-panel">
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      </div>
    );
  }

  const user = query.data;
  return (
    <div className="adm-page">
      <PageHeader
        back={{ to: '/users', label: 'Users' }}
        title={
          <>
            {user.email}
            <StatusBadge value={user.status} tones={USER_STATUS_TONE} />
            <RoleBadge role={user.role} />
          </>
        }
        subtitle={
          <span className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span>{user.displayName ?? 'No display name'}</span>
            <span className="row" style={{ gap: 4 }}>
              ID <Mono value={user.id} copy />
            </span>
            <span className="row" style={{ gap: 4 }}>
              UID <Mono value={user.uid} copy />
            </span>
          </span>
        }
        actions={
          <Button size="sm" icon="refresh" loading={query.isFetching} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        }
      />

      {user.status === 'FROZEN' && <Alert tone="warn">This account is frozen: trading and withdrawals are blocked until it is unfrozen.</Alert>}
      {user.status === 'DISABLED' && <Alert tone="error">This account is disabled: sign-in, trading and withdrawals are blocked.</Alert>}
      {user.role !== 'USER' && <Alert tone="info">This is a staff account with {user.role.replace(/_/g, ' ').toLowerCase()} back-office access.</Alert>}

      <div className="adm-detail">
        <div className="adm-stack">
          <ProfileCard user={user} />
          <UserControls user={user} />
        </div>
        <section className="adm-panel">
          <Tabs<TabKey>
            value={active?.value ?? 'balances'}
            tabs={tabs.map((t) => ({ value: t.value, label: t.label, count: t.count?.(user) }))}
            onChange={(tab) => set({ tab })}
          />
          {active?.render(user)}
        </section>
      </div>
    </div>
  );
}
