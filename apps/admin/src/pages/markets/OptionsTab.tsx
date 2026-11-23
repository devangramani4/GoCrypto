import type { MarketDto } from '@gocrypto/shared-types';
import { Badge, type Column, DataTable, EmptyState, Select } from '@gocrypto/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Amount, StatusBadge } from '../../components/cells';
import { Pagination } from '../../components/Pagination';
import { useApi } from '../../lib/ApiContext';
import { fmtDateTime, fmtRelative, fmtUtc } from '../../lib/format';
import { intParam, useSearchState } from '../../lib/hooks';
import { qk } from '../../lib/queryKeys';
import { MARKET_STATUS_TONE, type Tone } from '../../lib/status';

type ContractStatus = 'ACTIVE' | 'EXPIRED' | 'SETTLED';

const CONTRACT_TONE: Record<ContractStatus, Tone> = { ACTIVE: 'up', EXPIRED: 'warn', SETTLED: undefined };

/** The DTO has no lifecycle field; derive it from the settlement price and expiry. */
export function contractStatus(m: MarketDto, now = Date.now()): ContractStatus {
  if (m.option?.settlementPrice) return 'SETTLED';
  if (m.option && m.option.expiry <= now) return 'EXPIRED';
  return 'ACTIVE';
}

const columns: Column<MarketDto>[] = [
  {
    key: 'symbol',
    header: 'Contract',
    render: (m) => (
      <span>
        <strong className="adm-mono" style={{ fontWeight: 600 }}>
          {m.symbol}
        </strong>
        <span className="adm-cell-sub">#{m.id}</span>
      </span>
    ),
  },
  { key: 'underlying', header: 'Underlying', render: (m) => m.option?.underlying ?? m.base },
  { key: 'type', header: 'Type', render: (m) => (m.option ? <Badge tone={m.option.optionType === 'CALL' ? 'up' : 'down'}>{m.option.optionType}</Badge> : null) },
  { key: 'strike', header: 'Strike', align: 'right', render: (m) => <Amount value={m.option?.strike} maxDp={4} /> },
  {
    key: 'expiry',
    header: 'Expiry',
    render: (m) =>
      m.option ? (
        <span className="num" title={fmtUtc(m.option.expiry)}>
          {fmtDateTime(m.option.expiry, false)}
          <span className="adm-cell-sub">{fmtRelative(m.option.expiry)}</span>
        </span>
      ) : null,
  },
  { key: 'size', header: 'Contract size', align: 'right', render: (m) => <Amount value={m.option?.contractSize} /> },
  { key: 'tick', header: 'Tick', align: 'right', render: (m) => <Amount value={m.tickSize} /> },
  { key: 'lifecycle', header: 'Lifecycle', render: (m) => <StatusBadge value={contractStatus(m)} tones={CONTRACT_TONE} /> },
  { key: 'settle', header: 'Settlement', align: 'right', render: (m) => <Amount value={m.option?.settlementPrice} maxDp={4} /> },
  { key: 'status', header: 'Market status', render: (m) => <StatusBadge value={m.status} tones={MARKET_STATUS_TONE} /> },
];

const DEFAULTS = { underlying: '', status: '', page: '1', pageSize: '25' };

export function OptionsTab() {
  const client = useApi();
  const [s, set] = useSearchState(DEFAULTS);
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 25);
  const underlyings = useQuery({ queryKey: qk.underlyings, queryFn: () => client.options.underlyings(), staleTime: 5 * 60_000 });
  const params = { underlying: s.underlying || undefined, status: s.status || undefined, page, pageSize };
  const query = useQuery({ queryKey: qk.options(params), queryFn: () => client.admin.options(params), placeholderData: keepPreviousData });

  return (
    <>
      <div className="adm-toolbar">
        <span className="adm-filter-label">Underlying</span>
        <div className="adm-toolbar__field--sm">
          <Select
            size="sm"
            aria-label="Underlying"
            value={s.underlying}
            options={[{ value: '', label: 'All' }, ...(underlyings.data ?? []).map((u) => ({ value: u, label: u }))]}
            onChange={(e) => set({ underlying: e.target.value, page: '1' })}
          />
        </div>
        <span className="adm-filter-label">Lifecycle</span>
        <div className="adm-toolbar__field--sm">
          <Select
            size="sm"
            aria-label="Lifecycle"
            value={s.status}
            options={[
              { value: '', label: 'All' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'EXPIRED', label: 'Expired' },
              { value: 'SETTLED', label: 'Settled' },
            ]}
            onChange={(e) => set({ status: e.target.value, page: '1' })}
          />
        </div>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          Option contracts are listed automatically by the options lifecycle worker.
        </span>
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(m) => String(m.id)}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState icon="layers" title="No option contracts" description="Nothing matches these filters." />}
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
    </>
  );
}
