import type { AdminUserDetailDto, BalanceDto, DeviceDto, LedgerEntryDto, LoginHistoryDto, SessionDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { Badge, Button, type Column, DataTable, EmptyState, Segmented } from '@gocrypto/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Amount, DateTime, DateTimeStacked, Mono, StatusBadge, Usd } from '../../components/cells';
import { type AdminOrder, CancelOrderDialog, orderColumns } from '../../components/orders';
import { Pagination } from '../../components/Pagination';
import { useApi } from '../../lib/ApiContext';
import { dec, fmtAmount, fmtRelative, fmtUsd, fmtUtc } from '../../lib/format';
import { useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { humanize } from '../../lib/status';

// ───────────────────────────── balances ─────────────────────────────

const balanceColumns: Column<BalanceDto>[] = [
  { key: 'asset', header: 'Asset', render: (b) => <strong style={{ fontWeight: 600 }}>{b.asset}</strong> },
  { key: 'account', header: 'Account', render: (b) => <Badge>{humanize(b.account)}</Badge> },
  { key: 'available', header: 'Available', align: 'right', render: (b) => <Amount value={b.available} /> },
  { key: 'locked', header: 'Locked', align: 'right', render: (b) => <Amount value={b.locked} /> },
  { key: 'total', header: 'Total', align: 'right', render: (b) => <Amount value={b.total} /> },
  { key: 'usd', header: 'USD value', align: 'right', render: (b) => <Usd value={b.usdValue} /> },
];

export function BalancesTab({ user }: { user: AdminUserDetailDto }) {
  const rows = useMemo(() => [...user.balances].sort((a, b) => (dec(b.usdValue)?.comparedTo(dec(a.usdValue) ?? 0) ?? 0) || a.asset.localeCompare(b.asset)), [user.balances]);
  const totalUsd = useMemo(() => user.balances.reduce((acc, b) => acc.plus(dec(b.usdValue) ?? 0), D(0)), [user.balances]);
  return (
    <DataTable
      columns={balanceColumns}
      rows={rows}
      rowKey={(b) => `${b.account}:${b.asset}`}
      empty={<EmptyState icon="wallet" title="No balances" description="This user has not funded any account yet." />}
      footer={
        rows.length > 0 ? (
          <div className="adm-pager">
            <span>{rows.length} balance(s)</span>
            <span className="spacer" />
            <span>
              Total value <strong className="num" style={{ color: 'var(--c-text)' }}>{fmtUsd(totalUsd.toFixed())}</strong>
            </span>
          </div>
        ) : undefined
      }
    />
  );
}

// ───────────────────────────── sessions & devices ─────────────────────────────

const sessionColumns: Column<SessionDto>[] = [
  {
    key: 'device',
    header: 'Device',
    render: (s) => (
      <span>
        {s.deviceName ?? 'Unknown device'}
        <span className="adm-cell-sub">{s.platform}</span>
      </span>
    ),
  },
  { key: 'ip', header: 'IP', render: (s) => <Mono value={s.ip} /> },
  {
    key: 'ua',
    header: 'User agent',
    render: (s) => (
      <span className="truncate" style={{ display: 'inline-block', maxWidth: 200 }} title={s.userAgent ?? undefined}>
        {s.userAgent ?? '—'}
      </span>
    ),
  },
  { key: 'created', header: 'Signed in', render: (s) => <DateTimeStacked value={s.createdAt} /> },
  {
    key: 'used',
    header: 'Last active',
    render: (s) => (
      <span className="num" title={fmtUtc(s.lastUsedAt)}>
        {fmtRelative(s.lastUsedAt)}
      </span>
    ),
  },
  { key: 'expires', header: 'Expires', render: (s) => <DateTimeStacked value={s.expiresAt} /> },
];

export function SessionsTab({ user }: { user: AdminUserDetailDto }) {
  return (
    <DataTable
      columns={sessionColumns}
      rows={user.sessions}
      rowKey={(s) => s.id}
      empty={<EmptyState icon="monitor" title="No active sessions" description="The user is signed out everywhere." />}
    />
  );
}

const deviceColumns: Column<DeviceDto>[] = [
  {
    key: 'name',
    header: 'Device',
    render: (d) => (
      <span>
        {d.name ?? 'Unnamed device'}
        <span className="adm-cell-sub adm-mono truncate" style={{ maxWidth: 180 }} title={d.deviceId}>
          {d.deviceId}
        </span>
      </span>
    ),
  },
  { key: 'platform', header: 'Platform', render: (d) => <Badge>{d.platform}</Badge> },
  { key: 'ip', header: 'Last IP', render: (d) => <Mono value={d.lastIp} /> },
  { key: 'trusted', header: 'Trust', render: (d) => (d.trusted ? <Badge tone="up">Trusted</Badge> : <Badge>Untrusted</Badge>) },
  { key: 'push', header: 'Push', render: (d) => (d.pushEnabled ? <Badge tone="brand">On</Badge> : <span className="faint">Off</span>) },
  { key: 'first', header: 'First seen', render: (d) => <DateTimeStacked value={d.createdAt} /> },
  {
    key: 'seen',
    header: 'Last seen',
    render: (d) => (
      <span className="num" title={fmtUtc(d.lastSeenAt)}>
        {fmtRelative(d.lastSeenAt)}
      </span>
    ),
  },
];

export function DevicesTab({ user }: { user: AdminUserDetailDto }) {
  return <DataTable columns={deviceColumns} rows={user.devices} rowKey={(d) => d.id} empty={<EmptyState icon="smartphone" title="No registered devices" />} />;
}

// ───────────────────────────── logins ─────────────────────────────

const loginColumns: Column<LoginHistoryDto>[] = [
  { key: 'time', header: 'Time', render: (l) => <DateTime value={l.createdAt} /> },
  {
    key: 'result',
    header: 'Result',
    render: (l) => (l.success ? <Badge tone="up">Success</Badge> : <Badge tone="down">{l.reason ? humanize(l.reason) : 'Failed'}</Badge>),
  },
  { key: 'ip', header: 'IP', render: (l) => <Mono value={l.ip} /> },
  {
    key: 'device',
    header: 'Device',
    render: (l) => (
      <span>
        {l.deviceName ?? '—'}
        <span className="adm-cell-sub">{l.platform ?? ''}</span>
      </span>
    ),
  },
  {
    key: 'ua',
    header: 'User agent',
    render: (l) => (
      <span className="truncate" style={{ display: 'inline-block', maxWidth: 320 }} title={l.userAgent ?? undefined}>
        {l.userAgent ?? '—'}
      </span>
    ),
  },
];

export function LoginsTab({ user }: { user: AdminUserDetailDto }) {
  const client = useApi();
  const query = useQuery({ queryKey: qk.userLogins(user.id), queryFn: () => client.admin.userLoginHistory(user.id) });
  return (
    <DataTable
      columns={loginColumns}
      rows={query.data?.items}
      rowKey={(l) => l.id}
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      empty={<EmptyState icon="lock" title="No sign-in attempts recorded" />}
    />
  );
}

// ───────────────────────────── orders ─────────────────────────────

type OrderFilter = 'ALL' | 'OPEN' | 'FILLED' | 'CANCELLED';

export function OrdersTab({ user }: { user: AdminUserDetailDto }) {
  const client = useApi();
  const can = useCan();
  const [filter, setFilter] = useState<OrderFilter>('ALL');
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<AdminOrder | null>(null);
  const pageSize = 25;
  const params = { page, pageSize, status: filter === 'ALL' ? undefined : filter };
  const query = useQuery({ queryKey: qk.userOrders(user.id, params), queryFn: () => client.admin.userOrders(user.id, params), placeholderData: keepPreviousData });
  const columns = useMemo(() => orderColumns({ showUser: false, canCancel: can('orders.cancel'), onCancel: setCancelling }), [can, setCancelling]);
  return (
    <>
      <div className="adm-toolbar">
        <Segmented<OrderFilter>
          value={filter}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'OPEN', label: 'Open' },
            { value: 'FILLED', label: 'Filled' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(o) => o.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState icon="list" title="No orders" />}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} fetching={query.isFetching} onPageChange={setPage} />}
      <CancelOrderDialog order={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}

// ───────────────────────────── ledger ─────────────────────────────

const ledgerColumns: Column<LedgerEntryDto>[] = [
  { key: 'time', header: 'Time', render: (e) => <DateTimeStacked value={e.createdAt} /> },
  {
    key: 'type',
    header: 'Type',
    render: (e) => (
      <span>
        <StatusBadge value={e.type} dot={false} />
        <span className="adm-cell-sub">
          <strong style={{ fontWeight: 600, color: 'var(--c-text-muted)' }}>{e.asset}</strong> · {humanize(e.account)}
        </span>
      </span>
    ),
  },
  { key: 'avail', header: 'Available Δ', align: 'right', render: (e) => <Amount value={e.availableDelta} signed colored /> },
  { key: 'locked', header: 'Locked Δ', align: 'right', render: (e) => <Amount value={e.lockedDelta} signed colored /> },
  {
    key: 'after',
    header: 'Balance after',
    align: 'right',
    render: (e) => (
      <span>
        <Amount value={e.availableAfter} />
        <span className="adm-cell-sub num">locked {fmtAmount(e.lockedAfter)}</span>
      </span>
    ),
  },
  {
    key: 'ref',
    header: 'Reference',
    render: (e) => (
      <span className="adm-wrap" style={{ display: 'inline-block', maxWidth: 240 }}>
        {e.refType ? (
          <span className="adm-mono">
            {e.refType}
            {e.refId ? `:${e.refId}` : ''}
          </span>
        ) : (
          <span className="faint">—</span>
        )}
        {e.description && (
          <span className="adm-cell-sub truncate" title={e.description}>
            {e.description}
          </span>
        )}
      </span>
    ),
  },
];

export function LedgerTab({ user }: { user: AdminUserDetailDto }) {
  const client = useApi();
  const query = useInfiniteQuery({
    queryKey: qk.userLedger(user.id),
    queryFn: ({ pageParam }) => client.admin.userLedger(user.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items), [query.data]);
  return (
    <DataTable
      columns={ledgerColumns}
      rows={rows}
      rowKey={(e) => e.id}
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      empty={<EmptyState icon="file" title="No ledger entries" />}
      footer={
        rows && rows.length > 0 ? (
          <div className="adm-pager">
            <span className="num">{rows.length} entries loaded</span>
            <span className="spacer" />
            {query.hasNextPage ? (
              <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                Load older entries
              </Button>
            ) : (
              <span className="faint">End of ledger</span>
            )}
          </div>
        ) : undefined
      }
    />
  );
}
