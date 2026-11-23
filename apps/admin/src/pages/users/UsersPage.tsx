import { type AdminUserListItemDto, USER_ROLES, USER_STATUSES } from '@gocrypto/shared-types';
import { Badge, Button, type Column, DataTable, EmptyState, Select } from '@gocrypto/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { PageHeader, Panel, Toolbar } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { SearchInput } from '../../components/SearchInput';
import { DateTime, FlagBadge, RoleBadge, StatusBadge, UserLink } from '../../components/cells';
import { useApi } from '../../lib/ApiContext';
import { fmtRelative, fmtUtc } from '../../lib/format';
import { intParam, useSearchState } from '../../lib/hooks';
import { qk } from '../../lib/queryKeys';
import { USER_STATUS_TONE, humanize } from '../../lib/status';

const DEFAULTS = { q: '', status: '', role: '', page: '1', pageSize: '25' };

const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...USER_STATUSES.map((s) => ({ value: s, label: humanize(s) }))];
const ROLE_OPTIONS = [{ value: '', label: 'All roles' }, ...USER_ROLES.map((r) => ({ value: r, label: humanize(r) }))];

const columns: Column<AdminUserListItemDto>[] = [
  {
    key: 'user',
    header: 'User',
    render: (u) => (
      <div style={{ minWidth: 0 }}>
        <UserLink id={u.id} email={u.email} />
        <span className="adm-cell-sub">{u.displayName ?? 'No display name'}</span>
      </div>
    ),
  },
  {
    key: 'ids',
    header: 'ID / UID',
    render: (u) => (
      <span className="adm-mono">
        #{u.id}
        <span className="adm-cell-sub">{u.uid}</span>
      </span>
    ),
  },
  { key: 'role', header: 'Role', render: (u) => <RoleBadge role={u.role} /> },
  { key: 'status', header: 'Status', render: (u) => <StatusBadge value={u.status} tones={USER_STATUS_TONE} /> },
  {
    key: 'security',
    header: 'Security',
    render: (u) => (
      <span className="adm-chip-row">
        {u.twoFactorEnabled ? <Badge tone="up">2FA</Badge> : <Badge tone="warn">No 2FA</Badge>}
        {u.emailVerified ? (
          <span title="Email verified">
            <Badge>Email ✓</Badge>
          </span>
        ) : (
          <span title="Email not verified">
            <Badge tone="warn">Unverified</Badge>
          </span>
        )}
      </span>
    ),
  },
  { key: 'trading', header: 'Trading', render: (u) => <FlagBadge on={u.tradingEnabled} yes="On" no="Off" /> },
  { key: 'withdrawals', header: 'Withdrawals', render: (u) => <FlagBadge on={u.withdrawalsEnabled} yes="On" no="Off" /> },
  { key: 'kyc', header: 'KYC', align: 'right', render: (u) => <span className="num">L{u.kycLevel}</span> },
  { key: 'vip', header: 'VIP', align: 'right', render: (u) => <span className="num">{u.vipTier}</span> },
  { key: 'created', header: 'Created', render: (u) => <DateTime value={u.createdAt} /> },
  {
    key: 'login',
    header: 'Last login',
    render: (u) =>
      u.lastLoginAt ? (
        <span className="num" title={fmtUtc(u.lastLoginAt)}>
          {fmtRelative(u.lastLoginAt)}
        </span>
      ) : (
        <span className="faint">Never</span>
      ),
  },
];

export function UsersPage() {
  const client = useApi();
  const navigate = useNavigate();
  const [s, set] = useSearchState(DEFAULTS);
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 25);
  const params = { q: s.q || undefined, status: s.status || undefined, role: s.role || undefined, page, pageSize };
  const query = useQuery({ queryKey: qk.users(params), queryFn: () => client.admin.users(params), placeholderData: keepPreviousData });
  const filtered = Boolean(s.q || s.status || s.role);

  return (
    <div className="adm-page">
      <PageHeader title="Users" subtitle="Search accounts, check security posture and open a user to take action." />
      <Panel>
        <Toolbar>
          <SearchInput value={s.q} onChange={(q) => set({ q, page: '1' })} placeholder="Search email, UID, ID, name or phone" label="Search users" />
          <div className="adm-toolbar__field">
            <Select size="sm" aria-label="Status" value={s.status} options={STATUS_OPTIONS} onChange={(e) => set({ status: e.target.value, page: '1' })} />
          </div>
          <div className="adm-toolbar__field">
            <Select size="sm" aria-label="Role" value={s.role} options={ROLE_OPTIONS} onChange={(e) => set({ role: e.target.value, page: '1' })} />
          </div>
          {filtered && (
            <Button size="sm" variant="ghost" icon="x" onClick={() => set({ q: '', status: '', role: '', page: '1' })}>
              Clear filters
            </Button>
          )}
        </Toolbar>
        <DataTable
          columns={columns}
          rows={query.data?.items}
          rowKey={(u) => u.id}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(u) => navigate(`/users/${u.id}`)}
          empty={<EmptyState icon="users" title={filtered ? 'No users match these filters' : 'No users yet'} />}
        />
        {query.data && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={query.data.total}
            fetching={query.isFetching}
            onPageChange={(p) => set({ page: String(p) })}
            onPageSizeChange={(n) => set({ pageSize: String(n), page: '1' })}
          />
        )}
      </Panel>
    </div>
  );
}
