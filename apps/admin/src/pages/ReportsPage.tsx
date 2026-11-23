import type { RevenueReportRowDto } from '@gocrypto/shared-types';
import { D, type Decimal } from '@gocrypto/trading-utils';
import { Badge, Button, type Column, DataTable, EmptyState, Segmented, Tabs, TextInput } from '@gocrypto/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { PageHeader, Panel } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Amount } from '../components/cells';
import { useApi } from '../lib/ApiContext';
import { downloadCsv, toCsv } from '../lib/csv';
import { dec, fmtInt, fromDateInput, toDateInput } from '../lib/format';
import { useSearchState } from '../lib/hooks';
import { qk } from '../lib/queryKeys';
import { humanize } from '../lib/status';

type TabKey = 'revenue' | 'transactions';
type GroupBy = 'day' | 'week' | 'month';

const DAY = 86_400_000;

function defaults() {
  const now = Date.now();
  return { tab: 'revenue', groupBy: 'day', from: toDateInput(now - 29 * DAY), to: toDateInput(now) };
}

// ───────────────────────────── revenue aggregation ─────────────────────────────

export interface AssetTotals {
  asset: string;
  tradingFees: string;
  withdrawalFees: string;
  totalFees: string;
  fills: number;
  withdrawals: number;
}

/** Per-asset fee totals (fees are only additive within one asset). */
export function revenueTotals(rows: RevenueReportRowDto[]): AssetTotals[] {
  const map = new Map<string, { trading: Decimal; withdrawal: Decimal; fills: number; withdrawals: number }>();
  for (const r of rows) {
    const t = map.get(r.asset) ?? { trading: D(0), withdrawal: D(0), fills: 0, withdrawals: 0 };
    const fees = dec(r.fees) ?? D(0);
    if (r.marketType === 'WITHDRAWAL') {
      t.withdrawal = t.withdrawal.plus(fees);
      t.withdrawals += r.trades;
    } else {
      t.trading = t.trading.plus(fees);
      t.fills += r.trades;
    }
    map.set(r.asset, t);
  }
  return [...map.entries()]
    .map(([asset, t]) => ({
      asset,
      tradingFees: t.trading.toFixed(),
      withdrawalFees: t.withdrawal.toFixed(),
      totalFees: t.trading.plus(t.withdrawal).toFixed(),
      fills: t.fills,
      withdrawals: t.withdrawals,
    }))
    .sort((a, b) => a.asset.localeCompare(b.asset));
}

const totalsColumns: Column<AssetTotals>[] = [
  { key: 'asset', header: 'Fee asset', render: (r) => <strong style={{ fontWeight: 600 }}>{r.asset}</strong> },
  { key: 'trading', header: 'Trading fees', align: 'right', render: (r) => <Amount value={r.tradingFees} /> },
  { key: 'withdrawal', header: 'Withdrawal fees', align: 'right', render: (r) => <Amount value={r.withdrawalFees} /> },
  { key: 'total', header: 'Total fees', align: 'right', render: (r) => <strong><Amount value={r.totalFees} /></strong> },
  { key: 'fills', header: 'Fills', align: 'right', render: (r) => <span className="num">{fmtInt(r.fills)}</span> },
  { key: 'wd', header: 'Withdrawals', align: 'right', render: (r) => <span className="num">{fmtInt(r.withdrawals)}</span> },
];

const SOURCE_TONE = { SPOT: 'brand', FUTURES: 'up', OPTIONS: 'warn', WITHDRAWAL: undefined } as const;

const detailColumns: Column<RevenueReportRowDto>[] = [
  { key: 'period', header: 'Period', render: (r) => <span className="num">{r.period}</span> },
  { key: 'source', header: 'Source', render: (r) => <Badge tone={SOURCE_TONE[r.marketType]}>{humanize(r.marketType)}</Badge> },
  { key: 'asset', header: 'Fee asset', render: (r) => r.asset },
  { key: 'fees', header: 'Fees', align: 'right', render: (r) => <Amount value={r.fees} /> },
  { key: 'count', header: 'Count', align: 'right', render: (r) => <span className="num">{fmtInt(r.trades)}</span> },
  {
    key: 'volume',
    header: <span title="Trading: quote notional of the fills charged in this fee asset. Withdrawals: amount withdrawn.">Volume</span>,
    align: 'right',
    render: (r) => (
      <span>
        <Amount value={r.volume} maxDp={4} /> <span className="faint">{r.volumeAsset}</span>
      </span>
    ),
  },
];

interface TxRow {
  type: string;
  asset: string;
  count: number;
  availableDelta: string;
  lockedDelta: string;
}

function toTxRow(r: Record<string, unknown>): TxRow {
  return {
    type: String(r.type ?? ''),
    asset: String(r.asset ?? ''),
    count: Number(r.count ?? 0),
    availableDelta: String(r.availableDelta ?? '0'),
    lockedDelta: String(r.lockedDelta ?? '0'),
  };
}

const txColumns: Column<TxRow>[] = [
  { key: 'type', header: 'Ledger type', render: (r) => <span className="adm-mono">{r.type}</span> },
  { key: 'asset', header: 'Asset', render: (r) => <strong style={{ fontWeight: 600 }}>{r.asset}</strong> },
  { key: 'count', header: 'Entries', align: 'right', render: (r) => <span className="num">{fmtInt(r.count)}</span> },
  { key: 'avail', header: 'Net available Δ', align: 'right', render: (r) => <Amount value={r.availableDelta} signed colored /> },
  { key: 'locked', header: 'Net locked Δ', align: 'right', render: (r) => <Amount value={r.lockedDelta} signed colored /> },
];

// ───────────────────────────── page ─────────────────────────────

export function ReportsPage() {
  const client = useApi();
  const initial = useMemo(() => defaults(), []);
  const [s, set] = useSearchState(initial);
  const tab: TabKey = s.tab === 'transactions' ? 'transactions' : 'revenue';
  const groupBy: GroupBy = s.groupBy === 'week' || s.groupBy === 'month' ? s.groupBy : 'day';
  const from = fromDateInput(s.from, 'start');
  const to = fromDateInput(s.to, 'end');
  const rangeError = from === null || to === null ? 'Pick a valid date range' : from > to ? '“From” must be before “To”' : null;
  const params = { from: from ?? undefined, to: to ?? undefined, groupBy };

  const revenue = useQuery({
    queryKey: qk.revenue(params),
    queryFn: () => client.admin.revenue(params),
    enabled: tab === 'revenue' && !rangeError,
    placeholderData: keepPreviousData,
  });
  const transactions = useQuery({
    queryKey: qk.transactions({ from: params.from, to: params.to }),
    queryFn: () => client.admin.transactions({ from: params.from, to: params.to }),
    enabled: tab === 'transactions' && !rangeError,
    placeholderData: keepPreviousData,
    select: (rows) => rows.map(toTxRow).sort((a, b) => a.type.localeCompare(b.type) || a.asset.localeCompare(b.asset)),
  });

  const revenueRows = useMemo(() => [...(revenue.data ?? [])].sort((a, b) => b.period.localeCompare(a.period) || a.marketType.localeCompare(b.marketType) || a.asset.localeCompare(b.asset)), [revenue.data]);
  const totals = useMemo(() => revenueTotals(revenueRows), [revenueRows]);
  const fills = totals.reduce((n, t) => n + t.fills, 0);
  const wds = totals.reduce((n, t) => n + t.withdrawals, 0);
  const periods = new Set(revenueRows.map((r) => r.period)).size;

  const setRange = (days: number) => {
    const now = Date.now();
    set({ from: toDateInput(now - (days - 1) * DAY), to: toDateInput(now) });
  };

  const exportCsv = () => {
    const stamp = `${s.from}_${s.to}`;
    if (tab === 'revenue') {
      downloadCsv(
        `gocrypto-revenue-${groupBy}-${stamp}.csv`,
        toCsv(['period', 'source', 'fee_asset', 'fees', 'count', 'volume', 'volume_asset'], revenueRows.map((r) => [r.period, r.marketType, r.asset, r.fees, r.trades, r.volume, r.volumeAsset])),
      );
    } else {
      downloadCsv(
        `gocrypto-transactions-${stamp}.csv`,
        toCsv(['type', 'asset', 'entries', 'available_delta', 'locked_delta'], (transactions.data ?? []).map((r) => [r.type, r.asset, r.count, r.availableDelta, r.lockedDelta])),
      );
    }
  };

  const canExport = tab === 'revenue' ? revenueRows.length > 0 : (transactions.data?.length ?? 0) > 0;

  return (
    <div className="adm-page">
      <PageHeader
        title="Reports"
        subtitle="Fee revenue and ledger activity for customer accounts (system accounts excluded)."
        actions={
          <Button size="sm" icon="download" disabled={!canExport} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />
      <Panel>
        <Tabs<TabKey>
          value={tab}
          tabs={[
            { value: 'revenue', label: 'Revenue' },
            { value: 'transactions', label: 'Transactions' },
          ]}
          onChange={(t) => set({ tab: t })}
        />
        <div className="adm-toolbar">
          <span className="adm-filter-label">From</span>
          <div style={{ width: 150 }}>
            <TextInput size="sm" type="date" aria-label="From date" value={s.from} max={s.to} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <span className="adm-filter-label">To</span>
          <div style={{ width: 150 }}>
            <TextInput size="sm" type="date" aria-label="To date" value={s.to} min={s.from} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <Button size="sm" variant="ghost" onClick={() => setRange(7)}>
            7D
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRange(30)}>
            30D
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRange(90)}>
            90D
          </Button>
          {tab === 'revenue' && (
            <>
              <span className="spacer" />
              <span className="adm-filter-label">Group by</span>
              <Segmented<GroupBy>
                value={groupBy}
                options={[
                  { value: 'day', label: 'Day' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                ]}
                onChange={(g) => set({ groupBy: g })}
              />
            </>
          )}
        </div>
        {rangeError && (
          <div style={{ padding: 16 }}>
            <EmptyState icon="clock" title={rangeError} />
          </div>
        )}

        {!rangeError && tab === 'revenue' && (
          <div className="adm-stack" style={{ padding: 16 }}>
            <div className="adm-stat-grid">
              <StatCard icon="swap" label="Fee-paying fills" value={fmtInt(fills)} loading={revenue.isPending} />
              <StatCard icon="arrowUpRight" label="Completed withdrawals" value={fmtInt(wds)} loading={revenue.isPending} />
              <StatCard icon="dollar" label="Fee assets" value={fmtInt(totals.length)} sub="Totals are per asset (no FX conversion)" loading={revenue.isPending} />
              <StatCard icon="clock" label={`Periods (${groupBy})`} value={fmtInt(periods)} loading={revenue.isPending} />
            </div>
            <Panel title="Totals by fee asset">
              <DataTable
                columns={totalsColumns}
                rows={revenue.data ? totals : undefined}
                rowKey={(r) => r.asset}
                loading={revenue.isPending}
                error={revenue.error}
                onRetry={() => void revenue.refetch()}
                empty={<EmptyState icon="pie" title="No revenue in this range" />}
              />
            </Panel>
            <Panel title={`Detail by ${groupBy}`}>
              <DataTable
                columns={detailColumns}
                rows={revenue.data ? revenueRows : undefined}
                rowKey={(r) => `${r.period}:${r.marketType}:${r.asset}:${r.volumeAsset}`}
                loading={revenue.isPending}
                error={revenue.error}
                onRetry={() => void revenue.refetch()}
                empty="No fee events in this range"
                style={{ maxHeight: 560 }}
              />
            </Panel>
          </div>
        )}

        {!rangeError && tab === 'transactions' && (
          <DataTable
            columns={txColumns}
            rows={transactions.data}
            rowKey={(r) => `${r.type}:${r.asset}`}
            loading={transactions.isPending}
            error={transactions.error}
            onRetry={() => void transactions.refetch()}
            empty={<EmptyState icon="file" title="No ledger activity in this range" />}
          />
        )}
      </Panel>
    </div>
  );
}
