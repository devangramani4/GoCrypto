import type { BalanceDto } from '@gocrypto/shared-types';
import { D, type Decimal } from '@gocrypto/trading-utils';
import { Badge, type Column, DataTable, EmptyState, ErrorState, cx } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { BlockSkeleton } from '../../components/feedback';
import { Panel } from '../../components/PageHeader';
import { Amount, Usd } from '../../components/cells';
import { useApi } from '../../lib/ApiContext';
import { errorMessage } from '../../lib/errors';
import { dec, fmtInt, fmtUsd } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { humanize } from '../../lib/status';

interface LiabilityRow {
  key: string;
  asset: string;
  account: string | null;
  available: string;
  locked: string;
  total: string;
  wallets: number;
  subtotal: boolean;
}

/** Customer liabilities per asset/account plus a per-asset subtotal row (decimal-exact). */
export function liabilityRows(totals: Record<string, unknown>[]): LiabilityRow[] {
  const byAsset = new Map<string, { rows: LiabilityRow[]; available: Decimal; locked: Decimal; wallets: number }>();
  for (const t of totals) {
    const asset = String(t.asset ?? '');
    const available = dec(t.available) ?? D(0);
    const locked = dec(t.locked) ?? D(0);
    const total = dec(t.total) ?? available.plus(locked);
    const wallets = Number(t.users ?? 0);
    const g = byAsset.get(asset) ?? { rows: [], available: D(0), locked: D(0), wallets: 0 };
    g.rows.push({ key: `${asset}:${String(t.account)}`, asset, account: String(t.account ?? ''), available: available.toFixed(), locked: locked.toFixed(), total: total.toFixed(), wallets, subtotal: false });
    g.available = g.available.plus(available);
    g.locked = g.locked.plus(locked);
    g.wallets += wallets;
    byAsset.set(asset, g);
  }
  const out: LiabilityRow[] = [];
  for (const [asset, g] of [...byAsset.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(...g.rows.sort((a, b) => (a.account ?? '').localeCompare(b.account ?? '')));
    if (g.rows.length > 1) {
      out.push({ key: `${asset}:total`, asset, account: null, available: g.available.toFixed(), locked: g.locked.toFixed(), total: g.available.plus(g.locked).toFixed(), wallets: g.wallets, subtotal: true });
    }
  }
  return out;
}

const liabilityColumns: Column<LiabilityRow>[] = [
  { key: 'asset', header: 'Asset', render: (r) => <strong style={{ fontWeight: r.subtotal ? 700 : 600 }}>{r.subtotal ? `${r.asset} total` : r.asset}</strong> },
  { key: 'account', header: 'Account', render: (r) => (r.account ? <Badge>{humanize(r.account)}</Badge> : null) },
  { key: 'available', header: 'Available', align: 'right', render: (r) => <Amount value={r.available} /> },
  { key: 'locked', header: 'Locked', align: 'right', render: (r) => <Amount value={r.locked} /> },
  {
    key: 'total',
    header: 'Total liability',
    align: 'right',
    render: (r) => (
      <span className={cx(r.subtotal && 'adm-strong')}>
        <Amount value={r.total} />
      </span>
    ),
  },
  { key: 'wallets', header: 'Funded wallets', align: 'right', render: (r) => <span className="num">{fmtInt(r.wallets)}</span> },
];

const SYSTEM_LABELS: Record<string, { title: string; hint: string }> = {
  marketMaker: { title: 'Market maker', hint: 'Sandbox liquidity provider' },
  feeCollector: { title: 'Fee collector', hint: 'Trading and withdrawal fee revenue' },
  insuranceFund: { title: 'Insurance fund', hint: 'Covers liquidation shortfalls' },
};

/** Large system balances need no dust digits; small fee balances keep full precision. */
const dpFor = (v: string) => (dec(v)?.abs().gte(1000) ? 2 : 8);

const systemColumns: Column<BalanceDto>[] = [
  {
    key: 'asset',
    header: 'Asset',
    render: (b) => (
      <span>
        <strong style={{ fontWeight: 600 }}>{b.asset}</strong> <span className="faint">{humanize(b.account)}</span>
      </span>
    ),
  },
  { key: 'total', header: 'Total', align: 'right', render: (b) => <Amount value={b.total} maxDp={dpFor(b.total)} /> },
  { key: 'locked', header: 'Locked', align: 'right', render: (b) => <Amount value={b.locked} maxDp={dpFor(b.locked)} /> },
  { key: 'usd', header: 'USD', align: 'right', render: (b) => <Usd value={b.usdValue} /> },
];

function SystemWallet({ name, balances }: { name: string; balances: BalanceDto[] }) {
  const label = SYSTEM_LABELS[name] ?? { title: humanize(name), hint: 'System account' };
  const totalUsd = balances.reduce((acc, b) => acc.plus(dec(b.usdValue) ?? 0), D(0));
  const rows = [...balances].sort((a, b) => (dec(b.usdValue) ?? D(0)).comparedTo(dec(a.usdValue) ?? D(0)));
  return (
    <Panel
      title={
        <div>
          <h2 className="adm-panel__title">{label.title}</h2>
          <span className="adm-cell-sub">{label.hint}</span>
        </div>
      }
      actions={<strong className="num">{fmtUsd(totalUsd.toFixed())}</strong>}
    >
      <DataTable columns={systemColumns} rows={rows} rowKey={(b) => `${b.account}:${b.asset}`} empty="No balances" style={{ maxHeight: 320 }} />
    </Panel>
  );
}

export function BalancesView() {
  const client = useApi();
  const query = useQuery({ queryKey: qk.balances, queryFn: () => client.admin.balances() });
  const rows = useMemo(() => liabilityRows(query.data?.totals ?? []), [query.data]);
  if (query.isPending) return <BlockSkeleton rows={8} />;
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const system = Object.entries(query.data.system);
  return (
    <div className="adm-stack" style={{ padding: 16 }}>
      <div className="adm-section-label">System wallets</div>
      {system.length ? (
        <div className="adm-system-wallets">
          {system.map(([name, balances]) => (
            <SystemWallet key={name} name={name} balances={balances} />
          ))}
        </div>
      ) : (
        <EmptyState icon="wallet" title="No system wallets found" />
      )}
      <div className="adm-section-label">Customer liabilities</div>
      <Panel>
        <DataTable
          columns={liabilityColumns}
          rows={rows}
          rowKey={(r) => r.key}
          empty={<EmptyState icon="wallet" title="No customer balances" description="No user holds a non-zero balance yet." />}
        />
      </Panel>
    </div>
  );
}
