import type { MarketDto } from '@gocrypto/shared-types';
import { Button, type Column, DataTable, EmptyState, IconButton, Tabs } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActionDialog } from '../../components/ActionDialog';
import { GuardedButton } from '../../components/GuardedButton';
import { PageHeader, Panel } from '../../components/PageHeader';
import { SearchInput } from '../../components/SearchInput';
import { Amount, StatusBadge } from '../../components/cells';
import { useApi } from '../../lib/ApiContext';
import { errorMessage } from '../../lib/errors';
import { fmtRate } from '../../lib/format';
import { useSearchState } from '../../lib/hooks';
import { useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { MARKET_STATUS_TONE } from '../../lib/status';
import { useAction } from '../../lib/useAction';
import { type CreateKind, CreateMarketDialog } from './CreateMarketDialog';
import { MarketEditDialog } from './MarketEditDialog';
import { OptionsTab } from './OptionsTab';
import { RiskTiersDialog } from './RiskTiersDialog';

type TabKey = 'spot' | 'futures' | 'options';

/** Market-level maker / taker overrides ("0" from the API means no override → VIP schedule applies). */
function FeeOverrides({ maker, taker }: { maker: string; taker: string }) {
  if (maker === '0' && taker === '0') return <span className="faint">Schedule</span>;
  const part = (r: string) => (r === '0' ? <span className="faint">sched.</span> : fmtRate(r));
  return (
    <span className="num">
      {part(maker)} <span className="faint">/</span> {part(taker)}
    </span>
  );
}

interface RowActions {
  canWrite: boolean;
  onEdit: (m: MarketDto) => void;
  onTiers: (m: MarketDto) => void;
  onReload: (m: MarketDto) => void;
}

function symbolCell(m: MarketDto) {
  return (
    <span>
      <strong style={{ fontWeight: 600 }}>{m.symbol}</strong>
      <span className="adm-cell-sub">
        {m.displayName} · #{m.id}
      </span>
    </span>
  );
}

function spotColumns(a: RowActions): Column<MarketDto>[] {
  return [
    { key: 'symbol', header: 'Market', render: symbolCell },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge value={m.status} tones={MARKET_STATUS_TONE} /> },
    { key: 'tick', header: 'Tick size', align: 'right', render: (m) => <Amount value={m.tickSize} maxDp={12} /> },
    { key: 'step', header: 'Step size', align: 'right', render: (m) => <Amount value={m.stepSize} maxDp={12} /> },
    { key: 'min', header: 'Min qty', align: 'right', render: (m) => <Amount value={m.minQty} maxDp={12} /> },
    { key: 'max', header: 'Max qty', align: 'right', render: (m) => <Amount value={m.maxQty} maxDp={12} /> },
    { key: 'notional', header: 'Min notional', align: 'right', render: (m) => <Amount value={m.minNotional} asset={m.quote} /> },
    { key: 'band', header: 'Price band', align: 'right', render: (m) => <span className="num">±{fmtRate(m.priceBand, 2)}</span> },
    { key: 'fees', header: 'Fee override (maker / taker)', align: 'right', render: (m) => <FeeOverrides maker={m.makerFeeRate} taker={m.takerFeeRate} /> },
    { key: 'actions', header: '', align: 'right', className: 'adm-col-sticky', render: (m) => <RowButtons market={m} a={a} /> },
  ];
}

function RowButtons({ market, a, tiers }: { market: MarketDto; a: RowActions; tiers?: boolean }) {
  return (
    <span className="adm-table-actions">
      {tiers && (
        <Button size="sm" icon="layers" onClick={() => a.onTiers(market)} title="Risk tiers">
          Tiers ({market.futures?.riskTiers.length ?? 0})
        </Button>
      )}
      <Button size="sm" icon="pen" disabled={!a.canWrite} onClick={() => a.onEdit(market)}>
        Edit
      </Button>
      <IconButton icon="refresh" label={`Reload ${market.symbol} order book`} disabled={!a.canWrite} onClick={() => a.onReload(market)} />
    </span>
  );
}

function futuresColumns(a: RowActions): Column<MarketDto>[] {
  return [
    { key: 'symbol', header: 'Contract', render: symbolCell },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge value={m.status} tones={MARKET_STATUS_TONE} /> },
    { key: 'tick', header: 'Tick', align: 'right', render: (m) => <Amount value={m.tickSize} maxDp={12} /> },
    { key: 'step', header: 'Step', align: 'right', render: (m) => <Amount value={m.stepSize} maxDp={12} /> },
    {
      key: 'qty',
      header: 'Min / max qty',
      align: 'right',
      render: (m) => (
        <span className="num">
          <Amount value={m.minQty} maxDp={12} /> <span className="faint">/</span> <Amount value={m.maxQty} maxDp={12} />
        </span>
      ),
    },
    { key: 'notional', header: 'Min notional', align: 'right', render: (m) => <Amount value={m.minNotional} /> },
    {
      key: 'leverage',
      header: 'Leverage',
      align: 'right',
      render: (m) =>
        m.futures ? (
          <span className="num">
            {m.futures.defaultLeverage}x <span className="faint">/ max</span> {m.futures.maxLeverage}x
          </span>
        ) : null,
    },
    { key: 'funding', header: 'Funding', align: 'right', render: (m) => (m.futures ? <span className="num">{m.futures.fundingIntervalHours}h</span> : null) },
    { key: 'liq', header: 'Liq. fee', align: 'right', render: (m) => <span className="num">{fmtRate(m.futures?.liquidationFeeRate)}</span> },
    { key: 'fees', header: 'Fee override', align: 'right', render: (m) => <FeeOverrides maker={m.makerFeeRate} taker={m.takerFeeRate} /> },
    { key: 'actions', header: '', align: 'right', className: 'adm-col-sticky', render: (m) => <RowButtons market={m} a={a} tiers /> },
  ];
}

export function MarketsPage() {
  const client = useApi();
  const can = useCan();
  const [s, set] = useSearchState({ tab: 'spot', q: '' });
  const tab = (['spot', 'futures', 'options'] as const).includes(s.tab as TabKey) ? (s.tab as TabKey) : 'spot';
  const query = useQuery({ queryKey: qk.markets, queryFn: () => client.admin.markets() });
  const [editing, setEditing] = useState<MarketDto | null>(null);
  const [tiers, setTiers] = useState<MarketDto | null>(null);
  const [reloading, setReloading] = useState<MarketDto | null>(null);
  const [creating, setCreating] = useState<CreateKind | null>(null);

  const reload = useAction<MarketDto>({
    mutationFn: (m) => client.admin.reloadMarket(m.id),
    success: (_d, m) => `Order book reload requested for ${m.symbol}`,
    errorToast: false,
    onSuccess: () => setReloading(null),
  });

  const canWrite = can('markets.write');
  const actions: RowActions = { canWrite, onEdit: setEditing, onTiers: setTiers, onReload: setReloading };
  const q = s.q.trim().toUpperCase();
  const rows = useMemo(() => {
    const type = tab === 'futures' ? 'FUTURES' : 'SPOT';
    return (query.data ?? []).filter((m) => m.type === type && (!q || m.symbol.includes(q) || m.base.includes(q) || m.quote.includes(q)));
  }, [query.data, tab, q]);
  const counts = useMemo(
    () => ({ spot: query.data?.filter((m) => m.type === 'SPOT').length, futures: query.data?.filter((m) => m.type === 'FUTURES').length }),
    [query.data],
  );

  return (
    <div className="adm-page">
      <PageHeader
        title="Markets"
        subtitle="Trading pairs, perpetual contracts and option listings. Changes apply to the matching engine immediately."
        actions={
          <>
            <GuardedButton perm="markets.write" size="sm" icon="plus" onClick={() => setCreating('SPOT')}>
              New spot market
            </GuardedButton>
            <GuardedButton perm="markets.write" size="sm" icon="plus" onClick={() => setCreating('FUTURES')}>
              New futures market
            </GuardedButton>
          </>
        }
      />
      <Panel>
        <Tabs<TabKey>
          value={tab}
          tabs={[
            { value: 'spot', label: 'Spot', count: counts.spot },
            { value: 'futures', label: 'Futures', count: counts.futures },
            { value: 'options', label: 'Options' },
          ]}
          onChange={(t) => set({ tab: t, q: '' }, { reset: true })}
        />
        {tab === 'options' ? (
          <OptionsTab />
        ) : (
          <>
            <div className="adm-toolbar">
              <SearchInput value={s.q} onChange={(v) => set({ q: v })} placeholder="Filter by symbol or asset" delay={150} />
              <span className="spacer" />
              {!canWrite && <span className="faint" style={{ fontSize: 12 }}>Read-only — editing requires markets.write</span>}
            </div>
            <DataTable
              columns={tab === 'futures' ? futuresColumns(actions) : spotColumns(actions)}
              rows={query.data ? rows : undefined}
              rowKey={(m) => String(m.id)}
              loading={query.isPending}
              error={query.error}
              onRetry={() => void query.refetch()}
              empty={<EmptyState icon="candles" title={q ? 'No markets match this filter' : 'No markets configured'} />}
            />
          </>
        )}
      </Panel>

      <MarketEditDialog market={editing} onClose={() => setEditing(null)} />
      <RiskTiersDialog market={tiers} onClose={() => setTiers(null)} />
      <CreateMarketDialog kind={creating} onClose={() => setCreating(null)} />
      <ActionDialog
        open={reloading !== null}
        title="Reload order book"
        confirmLabel="Reload book"
        description={
          reloading && (
            <>
              The matching engine rebuilds the <strong>{reloading.symbol}</strong> order book from open orders in the database. Use this after a manual data fix
              or if the book looks out of sync. New commands for this market queue until the rebuild finishes.
            </>
          )
        }
        pending={reload.isPending}
        error={reload.error ? errorMessage(reload.error) : null}
        onConfirm={() => reloading && reload.mutate(reloading)}
        onClose={() => {
          reload.reset();
          setReloading(null);
        }}
      />
    </div>
  );
}
