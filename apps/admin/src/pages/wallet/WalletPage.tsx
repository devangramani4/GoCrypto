import { DEPOSIT_STATUSES, type DepositDto, WITHDRAWAL_STATUSES } from '@gocrypto/shared-types';
import { Badge, Button, type Column, DataTable, EmptyState, Progress, Select, Tabs } from '@gocrypto/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeader, Panel } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { SearchInput } from '../../components/SearchInput';
import { Amount, DateTimeStacked, Mono, StatusBadge, UserLink } from '../../components/cells';
import { useApi } from '../../lib/ApiContext';
import { fmtInt } from '../../lib/format';
import { intParam, useSearchState } from '../../lib/hooks';
import { useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { DEPOSIT_STATUS_TONE, humanize } from '../../lib/status';
import { BalancesView } from './BalancesView';
import { type AdminWithdrawal, ReviewDialog, type ReviewDecision, withdrawalColumns } from './withdrawals';

type TabKey = 'pending' | 'withdrawals' | 'deposits' | 'balances';
const TAB_KEYS: TabKey[] = ['pending', 'withdrawals', 'deposits', 'balances'];

const DEFAULTS = { tab: 'pending', status: '', asset: '', userId: '', q: '', page: '1', pageSize: '25' };

type DepositRow = DepositDto & { userEmail: string; userId?: string };

const depositColumns: Column<DepositRow>[] = [
  { key: 'time', header: 'Detected', render: (d) => <DateTimeStacked value={d.createdAt} /> },
  { key: 'user', header: 'User', render: (d) => <UserLink id={d.userId ?? null} email={d.userEmail} /> },
  { key: 'amount', header: 'Amount', align: 'right', render: (d) => <Amount value={d.amount} asset={d.asset} /> },
  { key: 'network', header: 'Network', render: (d) => <Badge>{d.network}</Badge> },
  {
    key: 'conf',
    header: 'Confirmations',
    render: (d) => (
      <span className="adm-risk">
        <span className="num" style={{ minWidth: 44 }}>
          {d.confirmations}/{d.requiredConfirmations}
        </span>
        <Progress value={d.requiredConfirmations ? Math.min(1, d.confirmations / d.requiredConfirmations) : 1} tone={d.status === 'COMPLETED' ? 'up' : undefined} />
      </span>
    ),
  },
  { key: 'status', header: 'Status', render: (d) => <StatusBadge value={d.status} tones={DEPOSIT_STATUS_TONE} /> },
  { key: 'tx', header: 'Tx hash', render: (d) => <Mono value={d.txHash} short copy /> },
  { key: 'address', header: 'Address', render: (d) => <Mono value={d.address} short copy /> },
  { key: 'credited', header: 'Credited', render: (d) => <DateTimeStacked value={d.creditedAt} /> },
];

export function WalletPage() {
  const client = useApi();
  const can = useCan();
  const [s, set] = useSearchState(DEFAULTS);
  const tab: TabKey = TAB_KEYS.includes(s.tab as TabKey) ? (s.tab as TabKey) : 'pending';
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 25);
  const [review, setReview] = useState<{ withdrawal: AdminWithdrawal; decision: ReviewDecision } | null>(null);
  const assets = useQuery({ queryKey: qk.assets, queryFn: () => client.assets.list(), staleTime: 5 * 60_000 });

  const pendingParams = { status: 'PENDING_REVIEW', page, pageSize };
  const withdrawalParams = { status: s.status || undefined, asset: s.asset || undefined, userId: s.userId || undefined, page, pageSize };
  const depositParams = { status: s.status || undefined, q: s.q || undefined, userId: s.userId || undefined, page, pageSize };

  const pending = useQuery({
    queryKey: qk.withdrawals(pendingParams),
    queryFn: () => client.admin.withdrawals(pendingParams),
    placeholderData: keepPreviousData,
    refetchInterval: tab === 'pending' ? 20_000 : false,
  });
  const withdrawals = useQuery({
    queryKey: qk.withdrawals(withdrawalParams),
    queryFn: () => client.admin.withdrawals(withdrawalParams),
    enabled: tab === 'withdrawals',
    placeholderData: keepPreviousData,
  });
  const deposits = useQuery({
    queryKey: qk.deposits(depositParams),
    queryFn: () => client.admin.deposits(depositParams) as Promise<{ items: DepositRow[]; total: number; page: number; pageSize: number }>,
    enabled: tab === 'deposits',
    placeholderData: keepPreviousData,
  });

  const canReview = can('withdrawals.review');
  const queueColumns = useMemo(() => withdrawalColumns({ queue: true, canReview, onReview: (w, decision) => setReview({ withdrawal: w, decision }) }), [canReview, setReview]);
  const allColumns = useMemo(() => withdrawalColumns({ queue: false, canReview, onReview: (w, decision) => setReview({ withdrawal: w, decision }) }), [canReview, setReview]);
  const pager = { page, pageSize, onPageChange: (p: number) => set({ page: String(p) }), onPageSizeChange: (n: number) => set({ pageSize: String(n), page: '1' }) };
  const assetOptions = [{ value: '', label: 'All assets' }, ...(assets.data ?? []).map((a) => ({ value: a.symbol, label: a.symbol }))];
  const filtered = Boolean(s.status || s.asset || s.userId || s.q);

  return (
    <div className="adm-page">
      <PageHeader title="Wallet" subtitle="Withdrawal review queue, deposit and withdrawal monitoring, and platform balances." />
      <Panel>
        <Tabs<TabKey>
          value={tab}
          tabs={[
            { value: 'pending', label: 'Pending review', count: pending.data?.total },
            { value: 'withdrawals', label: 'All withdrawals' },
            { value: 'deposits', label: 'Deposits' },
            { value: 'balances', label: 'Balances' },
          ]}
          onChange={(t) => set({ tab: t }, { reset: true })}
        />

        {tab === 'pending' && (
          <>
            <div className="adm-toolbar">
              <span className="muted" style={{ fontSize: 12 }}>
                Withdrawals scoring ≥ 50 or above the review threshold wait here. Oldest requests first is recommended; approved withdrawals are broadcast
                automatically.
              </span>
              <span className="spacer" />
              {!canReview && <Badge tone="warn">Read-only · requires withdrawals.review</Badge>}
            </div>
            <DataTable
              columns={queueColumns}
              rows={pending.data?.items}
              rowKey={(w) => w.id}
              loading={pending.isPending}
              error={pending.error}
              onRetry={() => void pending.refetch()}
              empty={<EmptyState icon="check" title="Review queue is clear" description="No withdrawal is waiting for manual review." />}
            />
            {pending.data && pending.data.total > 0 && <Pagination {...pager} total={pending.data.total} fetching={pending.isFetching} />}
          </>
        )}

        {tab === 'withdrawals' && (
          <>
            <div className="adm-toolbar">
              <div className="adm-toolbar__field">
                <Select
                  size="sm"
                  aria-label="Withdrawal status"
                  value={s.status}
                  options={[{ value: '', label: 'All statuses' }, ...WITHDRAWAL_STATUSES.map((v) => ({ value: v, label: humanize(v) }))]}
                  onChange={(e) => set({ status: e.target.value, page: '1' })}
                />
              </div>
              <div className="adm-toolbar__field--sm">
                <Select size="sm" aria-label="Asset" value={s.asset} options={assetOptions} onChange={(e) => set({ asset: e.target.value, page: '1' })} />
              </div>
              <SearchInput className="adm-toolbar__field--sm" value={s.userId} onChange={(v) => set({ userId: v.replace(/\D/g, ''), page: '1' })} placeholder="User ID" label="User ID" />
              {filtered && (
                <Button size="sm" variant="ghost" icon="x" onClick={() => set({ tab }, { reset: true })}>
                  Clear
                </Button>
              )}
            </div>
            <DataTable
              columns={allColumns}
              rows={withdrawals.data?.items}
              rowKey={(w) => w.id}
              loading={withdrawals.isPending}
              error={withdrawals.error}
              onRetry={() => void withdrawals.refetch()}
              empty={<EmptyState icon="arrowUpRight" title={filtered ? 'No withdrawals match these filters' : 'No withdrawals yet'} />}
            />
            {withdrawals.data && <Pagination {...pager} total={withdrawals.data.total} fetching={withdrawals.isFetching} />}
          </>
        )}

        {tab === 'deposits' && (
          <>
            <div className="adm-toolbar">
              <SearchInput value={s.q} onChange={(q) => set({ q, page: '1' })} placeholder="Tx hash, address or email" label="Search deposits" />
              <div className="adm-toolbar__field">
                <Select
                  size="sm"
                  aria-label="Deposit status"
                  value={s.status}
                  options={[{ value: '', label: 'All statuses' }, ...DEPOSIT_STATUSES.map((v) => ({ value: v, label: humanize(v) }))]}
                  onChange={(e) => set({ status: e.target.value, page: '1' })}
                />
              </div>
              <SearchInput className="adm-toolbar__field--sm" value={s.userId} onChange={(v) => set({ userId: v.replace(/\D/g, ''), page: '1' })} placeholder="User ID" label="User ID" />
              {filtered && (
                <Button size="sm" variant="ghost" icon="x" onClick={() => set({ tab }, { reset: true })}>
                  Clear
                </Button>
              )}
              <span className="spacer" />
              {deposits.data && <span className="faint" style={{ fontSize: 12 }}>{fmtInt(deposits.data.total)} deposits</span>}
            </div>
            <DataTable
              columns={depositColumns}
              rows={deposits.data?.items}
              rowKey={(d) => d.id}
              loading={deposits.isPending}
              error={deposits.error}
              onRetry={() => void deposits.refetch()}
              empty={<EmptyState icon="arrowDownLeft" title={filtered ? 'No deposits match these filters' : 'No deposits yet'} />}
            />
            {deposits.data && <Pagination {...pager} total={deposits.data.total} fetching={deposits.isFetching} />}
          </>
        )}

        {tab === 'balances' && <BalancesView />}
      </Panel>
      <ReviewDialog review={review} onClose={() => setReview(null)} />
    </div>
  );
}
