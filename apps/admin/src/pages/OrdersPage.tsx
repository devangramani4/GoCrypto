import { MARKET_TYPES, ORDER_STATUSES } from '@gocrypto/shared-types';
import { Badge, Button, type Column, DataTable, EmptyState, Select, Tabs } from '@gocrypto/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeader, Panel } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { Amount, DateTime, Mono, Side, UserLink } from '../components/cells';
import { type AdminOrder, CancelOrderDialog, orderColumns } from '../components/orders';
import { useApi } from '../lib/ApiContext';
import { intParam, useSearchState } from '../lib/hooks';
import { useCan } from '../lib/permissions';
import { qk } from '../lib/queryKeys';
import { humanize } from '../lib/status';

type TabKey = 'orders' | 'trades' | 'liquidations';

const DEFAULTS = { tab: '', symbol: '', marketType: '', status: '', userId: '', page: '1', pageSize: '25' };

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open (all working)' },
  ...ORDER_STATUSES.filter((s) => s !== 'OPEN').map((s) => ({ value: s, label: humanize(s) })),
];
const TYPE_OPTIONS = [{ value: '', label: 'All markets' }, ...MARKET_TYPES.map((t) => ({ value: t, label: humanize(t) }))];

/** Symbols accept the API's format only (uppercase, digits, dash). */
const normalizeSymbol = (v: string) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '');
const normalizeId = (v: string) => v.replace(/\D/g, '');

// ───────────────────────────── trades ─────────────────────────────

export interface AdminTrade {
  id: string;
  symbol: string;
  price: string;
  quantity: string;
  quoteQuantity: string;
  takerSide: string;
  makerUserId: string;
  takerUserId: string;
  makerFee: string;
  takerFee: string;
  isLiquidation: boolean;
  createdAt: number;
}

export function toTrade(r: Record<string, unknown>): AdminTrade {
  return {
    id: String(r.id ?? ''),
    symbol: String(r.symbol ?? ''),
    price: String(r.price ?? ''),
    quantity: String(r.quantity ?? ''),
    quoteQuantity: String(r.quoteQuantity ?? ''),
    takerSide: String(r.takerSide ?? ''),
    makerUserId: String(r.makerUserId ?? ''),
    takerUserId: String(r.takerUserId ?? ''),
    makerFee: String(r.makerFee ?? '0'),
    takerFee: String(r.takerFee ?? '0'),
    isLiquidation: Boolean(r.isLiquidation),
    createdAt: Number(r.createdAt ?? 0),
  };
}

const tradeColumns: Column<AdminTrade>[] = [
  { key: 'time', header: 'Time', render: (t) => <DateTime value={t.createdAt} /> },
  { key: 'id', header: 'Trade', render: (t) => <Mono value={t.id} /> },
  {
    key: 'symbol',
    header: 'Market',
    render: (t) => (
      <span className="row" style={{ gap: 6 }}>
        <strong style={{ fontWeight: 600 }}>{t.symbol}</strong>
        {t.isLiquidation && <Badge tone="down">Liquidation</Badge>}
      </span>
    ),
  },
  { key: 'side', header: 'Taker side', render: (t) => <Side side={t.takerSide} /> },
  { key: 'price', header: 'Price', align: 'right', render: (t) => <Amount value={t.price} /> },
  { key: 'qty', header: 'Quantity', align: 'right', render: (t) => <Amount value={t.quantity} /> },
  { key: 'quote', header: 'Quote value', align: 'right', render: (t) => <Amount value={t.quoteQuantity} maxDp={4} /> },
  { key: 'maker', header: 'Maker', render: (t) => <UserLink id={t.makerUserId} /> },
  { key: 'taker', header: 'Taker', render: (t) => <UserLink id={t.takerUserId} /> },
  { key: 'makerFee', header: 'Maker fee', align: 'right', render: (t) => <Amount value={t.makerFee} /> },
  { key: 'takerFee', header: 'Taker fee', align: 'right', render: (t) => <Amount value={t.takerFee} /> },
];

// ───────────────────────────── liquidations ─────────────────────────────

/** `/admin/liquidations` returns raw DB rows (snake_case, DATETIME as ISO string). */
export interface LiquidationRow {
  id: string;
  userId: string;
  email: string | null;
  symbol: string;
  side: string;
  quantity: string;
  entryPrice: string;
  markPrice: string;
  marginMode: string;
  margin: string;
  realizedPnl: string;
  liquidationFee: string;
  insuranceFundDelta: string;
  createdAt: unknown;
}

export function toLiquidation(r: Record<string, unknown>): LiquidationRow {
  const s = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
  return {
    id: s('id'),
    userId: s('user_id'),
    email: r.email ? String(r.email) : null,
    symbol: s('symbol') || `#${s('market_id')}`,
    side: s('side'),
    quantity: s('quantity'),
    entryPrice: s('entry_price'),
    markPrice: s('mark_price'),
    marginMode: s('margin_mode'),
    margin: s('margin'),
    realizedPnl: s('realized_pnl'),
    liquidationFee: s('liquidation_fee'),
    insuranceFundDelta: s('insurance_fund_delta'),
    createdAt: r.created_at,
  };
}

const liquidationColumns: Column<LiquidationRow>[] = [
  { key: 'time', header: 'Time', render: (l) => <DateTime value={l.createdAt} /> },
  { key: 'user', header: 'User', render: (l) => <UserLink id={l.userId} email={l.email} /> },
  { key: 'symbol', header: 'Contract', render: (l) => <strong style={{ fontWeight: 600 }}>{l.symbol}</strong> },
  { key: 'side', header: 'Side', render: (l) => <Side side={l.side} /> },
  { key: 'mode', header: 'Margin mode', render: (l) => <Badge>{humanize(l.marginMode)}</Badge> },
  { key: 'qty', header: 'Quantity', align: 'right', render: (l) => <Amount value={l.quantity} /> },
  { key: 'entry', header: 'Entry', align: 'right', render: (l) => <Amount value={l.entryPrice} maxDp={4} /> },
  { key: 'mark', header: 'Mark', align: 'right', render: (l) => <Amount value={l.markPrice} maxDp={4} /> },
  { key: 'margin', header: 'Margin', align: 'right', render: (l) => <Amount value={l.margin} maxDp={4} /> },
  { key: 'pnl', header: 'Realized PnL', align: 'right', render: (l) => <Amount value={l.realizedPnl} maxDp={4} signed colored /> },
  { key: 'fee', header: 'Liq. fee', align: 'right', render: (l) => <Amount value={l.liquidationFee} maxDp={4} /> },
  { key: 'fund', header: 'Insurance fund Δ', align: 'right', render: (l) => <Amount value={l.insuranceFundDelta} maxDp={4} signed colored /> },
];

// ───────────────────────────── page ─────────────────────────────

function useSymbolSuggestions() {
  const client = useApi();
  const markets = useQuery({ queryKey: ['markets', 'public'], queryFn: () => client.markets.list(), staleTime: 5 * 60_000, retry: false });
  return markets.data?.map((m) => m.symbol) ?? [];
}

export function OrdersPage() {
  const client = useApi();
  const can = useCan();
  const [s, set] = useSearchState(DEFAULTS);
  const tabs = useMemo(
    () =>
      [
        { value: 'orders' as const, label: 'Orders', perm: 'orders.read' as const },
        { value: 'trades' as const, label: 'Trades', perm: 'orders.read' as const },
        { value: 'liquidations' as const, label: 'Liquidations', perm: 'risk.read' as const },
      ].filter((t) => can(t.perm)),
    [can],
  );
  const tab: TabKey = tabs.find((t) => t.value === s.tab)?.value ?? tabs[0]?.value ?? 'orders';
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 25);
  const symbols = useSymbolSuggestions();
  const [cancelling, setCancelling] = useState<AdminOrder | null>(null);

  // The API rejects symbols shorter than 3 characters; ignore partial input instead of erroring.
  const symbol = s.symbol.length >= 3 ? s.symbol : undefined;
  const orderParams = {
    symbol,
    marketType: s.marketType || undefined,
    status: s.status || undefined,
    userId: s.userId || undefined,
    page,
    pageSize,
  };
  const tradeParams = { symbol, userId: s.userId || undefined, page, pageSize };
  const liqParams = { page, pageSize };

  const orders = useQuery({
    queryKey: qk.orders(orderParams),
    queryFn: () => client.admin.orders(orderParams),
    enabled: tab === 'orders',
    placeholderData: keepPreviousData,
    refetchInterval: s.status === 'OPEN' ? 15_000 : false,
  });
  const trades = useQuery({
    queryKey: qk.trades(tradeParams),
    queryFn: () => client.admin.trades(tradeParams),
    enabled: tab === 'trades',
    placeholderData: keepPreviousData,
    select: (d) => ({ ...d, items: d.items.map(toTrade) }),
  });
  const liquidations = useQuery({
    queryKey: qk.liquidations(liqParams),
    queryFn: () => client.admin.liquidations(liqParams),
    enabled: tab === 'liquidations',
    placeholderData: keepPreviousData,
    select: (rows) => rows.map(toLiquidation),
  });

  const columns = useMemo(() => orderColumns({ showUser: true, canCancel: can('orders.cancel'), onCancel: setCancelling }), [can, setCancelling]);
  const filtered = Boolean(s.symbol || s.marketType || s.status || s.userId);
  const pager = { page, pageSize, onPageChange: (p: number) => set({ page: String(p) }), onPageSizeChange: (n: number) => set({ pageSize: String(n), page: '1' }) };

  return (
    <div className="adm-page">
      <PageHeader title="Orders & trades" subtitle="Monitor order flow across all markets, cancel orders on behalf of users and review executions." />
      <Panel>
        <Tabs<TabKey> value={tab} tabs={tabs.map((t) => ({ value: t.value, label: t.label }))} onChange={(t) => set({ tab: t }, { reset: true })} />
        {tab !== 'liquidations' && (
          <div className="adm-toolbar">
            <SearchInput
              className="adm-toolbar__field"
              value={s.symbol}
              onChange={(v) => set({ symbol: normalizeSymbol(v), page: '1' })}
              placeholder="Symbol, e.g. BTCUSDT"
              label="Symbol"
              list="adm-symbols"
            />
            {tab === 'orders' && (
              <>
                <div className="adm-toolbar__field">
                  <Select size="sm" aria-label="Market type" value={s.marketType} options={TYPE_OPTIONS} onChange={(e) => set({ marketType: e.target.value, page: '1' })} />
                </div>
                <div className="adm-toolbar__field">
                  <Select size="sm" aria-label="Order status" value={s.status} options={STATUS_OPTIONS} onChange={(e) => set({ status: e.target.value, page: '1' })} />
                </div>
              </>
            )}
            <SearchInput className="adm-toolbar__field--sm" value={s.userId} onChange={(v) => set({ userId: normalizeId(v), page: '1' })} placeholder="User ID" label="User ID" />
            {filtered && (
              <Button size="sm" variant="ghost" icon="x" onClick={() => set({ tab: s.tab }, { reset: true })}>
                Clear
              </Button>
            )}
            <datalist id="adm-symbols">
              {symbols.map((sym) => (
                <option key={sym} value={sym} />
              ))}
            </datalist>
            <span className="spacer" />
            {tab === 'orders' && s.status === 'OPEN' && <span className="faint" style={{ fontSize: 12 }}>Auto-refreshing every 15s</span>}
          </div>
        )}

        {tab === 'orders' && (
          <>
            <DataTable
              columns={columns}
              rows={orders.data?.items}
              rowKey={(o) => o.id}
              loading={orders.isPending}
              error={orders.error}
              onRetry={() => void orders.refetch()}
              empty={<EmptyState icon="list" title={filtered ? 'No orders match these filters' : 'No orders yet'} />}
            />
            {orders.data && <Pagination {...pager} total={orders.data.total} fetching={orders.isFetching} />}
          </>
        )}
        {tab === 'trades' && (
          <>
            <DataTable
              columns={tradeColumns}
              rows={trades.data?.items}
              rowKey={(t) => t.id}
              loading={trades.isPending}
              error={trades.error}
              onRetry={() => void trades.refetch()}
              empty={<EmptyState icon="swap" title={filtered ? 'No trades match these filters' : 'No trades yet'} />}
            />
            {trades.data && <Pagination {...pager} total={trades.data.total} fetching={trades.isFetching} />}
          </>
        )}
        {tab === 'liquidations' && (
          <>
            <DataTable
              columns={liquidationColumns}
              rows={liquidations.data}
              rowKey={(l) => l.id}
              loading={liquidations.isPending}
              error={liquidations.error}
              onRetry={() => void liquidations.refetch()}
              empty={<EmptyState icon="bolt" title="No liquidations" description="No futures position has been liquidated yet." />}
            />
            {liquidations.data && <Pagination {...pager} count={liquidations.data.length} fetching={liquidations.isFetching} />}
          </>
        )}
      </Panel>
      <CancelOrderDialog order={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}
