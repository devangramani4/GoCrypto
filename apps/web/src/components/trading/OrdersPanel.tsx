import type { FillDto, MarketDto, MarketType, OrderDto } from '@gocrypto/shared-types';
import { D, formatNumber } from '@gocrypto/trading-utils';
import { Badge, Button, Checkbox, DataTable, Progress, Tabs, useToast, type Column } from '@gocrypto/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtPrice, fmtQty, humanize } from '../../lib/format';
import { useAuthed, useBalances, useFuturesAccount, useMarketMap, useOpenOrders } from '../../lib/hooks';
import { AssetLabel, PnL } from '../common';
import { FuturesPositionsTable } from './PositionsTable';

const ORDER_TYPE_LABEL: Record<string, string> = {
  LIMIT: 'Limit',
  MARKET: 'Market',
  STOP_LIMIT: 'Stop Limit',
  STOP_MARKET: 'Stop Market',
  TAKE_PROFIT_LIMIT: 'TP Limit',
  TAKE_PROFIT_MARKET: 'TP Market',
};

export function statusTone(status: string): 'up' | 'down' | 'warn' | 'brand' | undefined {
  if (status === 'FILLED' || status === 'COMPLETED') return 'up';
  if (status === 'REJECTED' || status === 'FAILED') return 'down';
  if (status === 'PARTIALLY_FILLED' || status === 'PENDING_REVIEW' || status === 'CONFIRMING' || status === 'PROCESSING') return 'warn';
  if (status === 'OPEN' || status === 'NEW' || status === 'PENDING' || status === 'APPROVED') return 'brand';
  return undefined;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{humanize(status)}</Badge>;
}

function orderTypeLabel(o: OrderDto): ReactNode {
  const base = ORDER_TYPE_LABEL[o.type] ?? humanize(o.type);
  const flags = [o.postOnly && 'Post', o.reduceOnly && 'Reduce', o.closePosition && 'Close', o.ocoGroupId && 'OCO'].filter(Boolean).join(' · ');
  return (
    <span className="col" style={{ gap: 1 }}>
      <span>{base}</span>
      {flags && <span className="faint" style={{ fontSize: 10 }}>{flags}</span>}
    </span>
  );
}

function useOrderColumns(kind: 'open' | 'history', markets: Map<string, MarketDto>, onCancel?: (o: OrderDto) => void, cancelling?: string | null): Column<OrderDto>[] {
  const cols: Column<OrderDto>[] = [
    { key: 'time', header: 'Time', render: (o) => <span className="muted num">{fmtDateTime(o.createdAt)}</span> },
    {
      key: 'symbol',
      header: 'Pair',
      render: (o) => (
        <Link to={o.marketType === 'FUTURES' ? `/futures/${o.symbol}` : o.marketType === 'OPTIONS' ? '/options' : `/trade/${o.symbol}`} className="strong-link">
          {o.symbol}
        </Link>
      ),
    },
    { key: 'type', header: 'Type', render: orderTypeLabel },
    {
      key: 'side',
      header: 'Side',
      render: (o) => <span className={o.side === 'BUY' ? 'up' : 'down'}>{o.marketType === 'FUTURES' ? (o.side === 'BUY' ? (o.reduceOnly ? 'Close short' : 'Buy/Long') : o.reduceOnly ? 'Close long' : 'Sell/Short') : o.side === 'BUY' ? 'Buy' : 'Sell'}</span>,
    },
    {
      key: 'price',
      header: kind === 'history' ? 'Avg / Price' : 'Price',
      align: 'right',
      render: (o) => (
        <span className="num">
          {kind === 'history' && o.avgPrice ? `${fmtPrice(o.avgPrice, markets.get(o.symbol))} / ` : ''}
          {o.price ? fmtPrice(o.price, markets.get(o.symbol)) : 'Market'}
        </span>
      ),
    },
    {
      key: 'trigger',
      header: 'Trigger',
      align: 'right',
      render: (o) => (o.stopPrice ? <span className="num">{`${o.triggerState === 'TRIGGERED' ? '✓ ' : ''}${fmtPrice(o.stopPrice, markets.get(o.symbol))}`}</span> : <span className="faint">—</span>),
    },
    {
      key: 'amount',
      header: 'Filled / Amount',
      align: 'right',
      render: (o) => {
        const m = markets.get(o.symbol);
        const qty = o.quantity ?? (o.quoteQuantity ? `${formatNumber(o.quoteQuantity, 2)} ${m?.quote ?? ''}` : '—');
        const pct = o.quantity && D(o.quantity).gt(0) ? D(o.filledQuantity).div(o.quantity).mul(100).toNumber() : o.status === 'FILLED' ? 100 : 0;
        return (
          <span className="col num" style={{ gap: 3, alignItems: 'flex-end' }}>
            <span>
              {fmtQty(o.filledQuantity, m)} / {o.quantity ? fmtQty(o.quantity, m) : qty}
            </span>
            {kind === 'open' && <span style={{ width: 70 }}><Progress value={pct} tone="up" /></span>}
          </span>
        );
      },
    },
  ];
  if (kind === 'history') {
    cols.push({ key: 'fee', header: 'Fee', align: 'right', render: (o) => (D(o.feeTotal).gt(0) ? <span className="num muted">{`${formatNumber(o.feeTotal, 6, { trim: true })} ${o.feeAsset ?? ''}`}</span> : <span className="faint">—</span>) });
    cols.push({
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (o) => (
        <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
          <StatusBadge status={o.status} />
          {o.rejectReason && <span className="faint" style={{ fontSize: 10 }}>{humanize(o.rejectReason)}</span>}
        </span>
      ),
    });
  } else {
    cols.push({ key: 'status', header: 'Status', align: 'right', render: (o) => <StatusBadge status={o.triggerState === 'PENDING' ? 'PENDING' : o.status} /> });
    cols.push({
      key: 'cancel',
      header: '',
      align: 'right',
      render: (o) => (
        <Button size="sm" variant="ghost" loading={cancelling === o.id} onClick={() => onCancel?.(o)}>
          Cancel
        </Button>
      ),
    });
  }
  return cols;
}

export function OpenOrdersTable({ marketType, symbol }: { marketType: MarketType; symbol?: string }) {
  const { data, isLoading, error, refetch } = useOpenOrders(marketType);
  const markets = useMarketMap();
  const toast = useToast();
  const qc = useQueryClient();
  const rows = useMemo(() => (data ?? []).filter((o) => !symbol || o.symbol === symbol), [data, symbol]);
  const cancel = useMutation({
    mutationFn: (o: OrderDto) => api.orders.cancel(o.id),
    onSuccess: () => {
      toast.success('Order cancelled');
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['balances'] });
      void qc.invalidateQueries({ queryKey: ['futures-account'] });
    },
    onError: (e) => toast.error('Cancel failed', errorMessage(e)),
  });
  const columns = useOrderColumns('open', markets, (o) => cancel.mutate(o), cancel.isPending ? (cancel.variables?.id ?? null) : null);
  return <DataTable columns={columns} rows={rows} rowKey={(o) => o.id} loading={isLoading} error={error} onRetry={() => void refetch()} empty="No open orders" />;
}

export function CancelAllButton({ marketType, symbol }: { marketType: MarketType; symbol?: string }) {
  const { data } = useOpenOrders(marketType);
  const toast = useToast();
  const qc = useQueryClient();
  const count = (data ?? []).filter((o) => !symbol || o.symbol === symbol).length;
  const run = useMutation({
    mutationFn: async () => {
      if (symbol) return api.orders.cancelAll(symbol);
      const ids = (data ?? []).map((o) => o.id);
      await Promise.all(ids.map((id) => api.orders.cancel(id).catch(() => null)));
      return { cancelled: ids };
    },
    onSuccess: (r) => {
      toast.success(`Cancelled ${r.cancelled.length} order${r.cancelled.length === 1 ? '' : 's'}`);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (e) => toast.error('Cancel all failed', errorMessage(e)),
  });
  if (!count) return null;
  return (
    <Button size="sm" variant="ghost" loading={run.isPending} onClick={() => run.mutate()}>
      Cancel all ({count})
    </Button>
  );
}

export function OrderHistoryTable({ marketType, symbol, pageSize = 50 }: { marketType?: MarketType; symbol?: string; pageSize?: number }) {
  const authed = useAuthed();
  const markets = useMarketMap();
  const q = useInfiniteQuery({
    queryKey: ['orders', 'history', marketType ?? 'all', symbol ?? 'all'],
    queryFn: ({ pageParam }) => api.orders.history({ marketType, symbol, cursor: pageParam, limit: pageSize }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
  const rows = q.data?.pages.flatMap((p) => p.items);
  const columns = useOrderColumns('history', markets);
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(o) => o.id}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      empty="No orders yet"
      footer={q.hasNextPage ? <LoadMore onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : undefined}
    />
  );
}

export function TradeHistoryTable({ marketType, symbol, pageSize = 50 }: { marketType?: MarketType; symbol?: string; pageSize?: number }) {
  const authed = useAuthed();
  const markets = useMarketMap();
  const q = useInfiniteQuery({
    queryKey: ['fills', marketType ?? 'all', symbol ?? 'all'],
    queryFn: ({ pageParam }) => api.trades.history({ marketType, symbol, cursor: pageParam, limit: pageSize }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
  const columns: Column<FillDto>[] = [
    { key: 'time', header: 'Time', render: (f) => <span className="muted num">{fmtDateTime(f.ts)}</span> },
    { key: 'symbol', header: 'Pair', render: (f) => <strong>{f.symbol}</strong> },
    { key: 'side', header: 'Side', render: (f) => <span className={f.side === 'BUY' ? 'up' : 'down'}>{f.side === 'BUY' ? 'Buy' : 'Sell'}</span> },
    { key: 'price', header: 'Price', align: 'right', render: (f) => <span className="num">{fmtPrice(f.price, markets.get(f.symbol))}</span> },
    { key: 'qty', header: 'Quantity', align: 'right', render: (f) => <span className="num">{fmtQty(f.qty, markets.get(f.symbol))}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (f) => <span className="num">{formatNumber(f.quoteQty, 2)}</span> },
    { key: 'fee', header: 'Fee', align: 'right', render: (f) => <span className="num muted">{`${formatNumber(f.fee, 8, { trim: true })} ${f.feeAsset}`}</span> },
    { key: 'role', header: 'Role', align: 'right', render: (f) => <span className="faint">{f.isMaker ? 'Maker' : 'Taker'}</span> },
  ];
  if (marketType !== 'SPOT') columns.push({ key: 'pnl', header: 'Realized PnL', align: 'right', render: (f) => <PnL value={f.realizedPnl} /> });
  return (
    <DataTable
      columns={columns}
      rows={q.data?.pages.flatMap((p) => p.items)}
      rowKey={(f) => f.id}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      empty="No trades yet"
      footer={q.hasNextPage ? <LoadMore onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : undefined}
    />
  );
}

export function FundingHistoryTable() {
  const authed = useAuthed();
  const q = useQuery({ queryKey: ['funding-history'], queryFn: () => api.futures.fundingHistory(), enabled: authed });
  return (
    <DataTable
      columns={[
        { key: 't', header: 'Time', render: (f) => <span className="muted num">{fmtDateTime(f.fundingTime)}</span> },
        { key: 's', header: 'Contract', render: (f) => <strong>{f.symbol}</strong> },
        { key: 'q', header: 'Position', align: 'right', render: (f) => <span className="num">{f.positionQty}</span> },
        { key: 'r', header: 'Rate', align: 'right', render: (f) => <span className="num">{D(f.rate).mul(100).toFixed(4)}%</span> },
        { key: 'm', header: 'Mark price', align: 'right', render: (f) => <span className="num">{formatNumber(f.markPrice, 2)}</span> },
        { key: 'a', header: 'Payment', align: 'right', render: (f) => <PnL value={f.amount} suffix="USDT" /> },
      ]}
      rows={q.data}
      rowKey={(f) => f.id}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      empty="No funding payments yet"
    />
  );
}

function SpotAssets({ market }: { market: MarketDto }) {
  const { data, isLoading } = useBalances('SPOT');
  const rows = (data ?? []).filter((b) => b.asset === market.base || b.asset === market.quote || D(b.total).gt(0));
  return (
    <DataTable
      columns={[
        { key: 'a', header: 'Asset', render: (b) => <AssetLabel asset={b.asset} /> },
        { key: 't', header: 'Total', align: 'right', render: (b) => <span className="num">{formatNumber(b.total, 8, { trim: true })}</span> },
        { key: 'v', header: 'Available', align: 'right', render: (b) => <span className="num">{formatNumber(b.available, 8, { trim: true })}</span> },
        { key: 'l', header: 'In orders', align: 'right', render: (b) => <span className="num muted">{formatNumber(b.locked, 8, { trim: true })}</span> },
        { key: 'u', header: 'Value (USD)', align: 'right', render: (b) => <span className="num">${formatNumber(b.usdValue, 2)}</span> },
      ]}
      rows={rows}
      rowKey={(b) => b.asset}
      loading={isLoading}
      empty="No assets"
    />
  );
}

function FuturesAssets() {
  const { data: a, isLoading } = useFuturesAccount();
  if (isLoading || !a) return <div className="gc-state">Loading…</div>;
  const items: [string, ReactNode][] = [
    ['Wallet balance', `${formatNumber(a.walletBalance, 2)} ${a.asset}`],
    ['Unrealized PnL', <PnL key="u" value={a.unrealizedPnl} suffix={a.asset} />],
    ['Margin balance', `${formatNumber(a.marginBalance, 2)} ${a.asset}`],
    ['Position margin', `${formatNumber(a.positionMargin, 2)} ${a.asset}`],
    ['Order margin', `${formatNumber(a.orderMargin, 2)} ${a.asset}`],
    ['Available', `${formatNumber(a.availableBalance, 2)} ${a.asset}`],
    ['Maintenance margin', `${formatNumber(a.maintenanceMargin, 2)} ${a.asset}`],
    ['Margin ratio', `${D(a.marginRatio).mul(100).toFixed(2)}%`],
  ];
  return (
    <div className="acct-grid">
      {items.map(([k, v]) => (
        <div key={k} className="acct-grid__item">
          <span className="faint">{k}</span>
          <span className="num">{v}</span>
        </div>
      ))}
    </div>
  );
}

function LoadMore({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}>
      <Button size="sm" variant="ghost" loading={loading} onClick={onClick}>
        Load more
      </Button>
    </div>
  );
}

type SpotTab = 'open' | 'history' | 'trades' | 'assets';
type FuturesTab = 'positions' | 'open' | 'history' | 'trades' | 'funding' | 'assets';

/** Bottom panel of the trading screens. */
export function OrdersPanel({ kind, market }: { kind: 'spot' | 'futures'; market: MarketDto }) {
  const authed = useAuthed();
  const marketType: MarketType = kind === 'futures' ? 'FUTURES' : 'SPOT';
  const [tab, setTab] = useState<SpotTab | FuturesTab>(kind === 'futures' ? 'positions' : 'open');
  const [onlyThis, setOnlyThis] = useState(false);
  const { data: open } = useOpenOrders(marketType);
  const { data: positions } = useQuery({ queryKey: ['positions', 'futures'], queryFn: () => api.futures.positions(), enabled: authed && kind === 'futures' });
  const symbol = onlyThis ? market.symbol : undefined;
  const openCount = (open ?? []).filter((o) => !symbol || o.symbol === symbol).length;
  const tabs =
    kind === 'futures'
      ? [
          { value: 'positions' as const, label: 'Positions', count: (positions ?? []).filter((p) => !symbol || p.symbol === symbol).length },
          { value: 'open' as const, label: 'Open orders', count: openCount },
          { value: 'history' as const, label: 'Order history' },
          { value: 'trades' as const, label: 'Trade history' },
          { value: 'funding' as const, label: 'Funding' },
          { value: 'assets' as const, label: 'Assets' },
        ]
      : [
          { value: 'open' as const, label: 'Open orders', count: openCount },
          { value: 'history' as const, label: 'Order history' },
          { value: 'trades' as const, label: 'Trade history' },
          { value: 'assets' as const, label: 'Assets' },
        ];
  return (
    <div className="orders-panel">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={tabs}
        right={
          authed && (
            <span className="row" style={{ gap: 10, paddingRight: 8 }}>
              {tab === 'open' && <CancelAllButton marketType={marketType} symbol={symbol} />}
              <Checkbox checked={onlyThis} onChange={setOnlyThis}>
                Current pair only
              </Checkbox>
            </span>
          )
        }
      />
      <div className="orders-panel__body">
        {!authed ? (
          <div className="gc-state">
            <span>
              <Link to="/login">Log in</Link> or <Link to="/register">create an account</Link> to trade.
            </span>
          </div>
        ) : tab === 'positions' ? (
          <FuturesPositionsTable symbol={symbol} />
        ) : tab === 'open' ? (
          <OpenOrdersTable marketType={marketType} symbol={symbol} />
        ) : tab === 'history' ? (
          <OrderHistoryTable marketType={marketType} symbol={symbol} pageSize={25} />
        ) : tab === 'trades' ? (
          <TradeHistoryTable marketType={marketType} symbol={symbol} pageSize={25} />
        ) : tab === 'funding' ? (
          <FundingHistoryTable />
        ) : kind === 'futures' ? (
          <FuturesAssets />
        ) : (
          <SpotAssets market={market} />
        )}
      </div>
    </div>
  );
}
