import type { FillDto, OrderDto, OrderStatus } from '@gocrypto/shared-types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  EmptyState,
  ErrorState,
  PnLText,
  SkeletonRows,
  Tabs,
  Txt,
  type BadgeTone,
} from '../../components';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { fmtDateTime, formatNumber, formatPrice, formatQty, humanize } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';

type PanelTab = 'open' | 'history' | 'trades';
type PanelMarket = 'SPOT' | 'FUTURES';

interface OrdersPanelProps {
  marketType: PanelMarket;
  symbol: string;
  tickSize: string;
  stepSize: string;
}

const PAGE = 15;

function statusTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case 'FILLED':
      return 'up';
    case 'PARTIALLY_FILLED':
      return 'warn';
    case 'REJECTED':
    case 'EXPIRED':
      return 'down';
    case 'NEW':
    case 'OPEN':
      return 'brand';
    default:
      return 'neutral';
  }
}

/** Open orders (cancellable), order history and trade history for one market type. */
export function OrdersPanel({ marketType, symbol, tickSize, stepSize }: OrdersPanelProps) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [tab, setTab] = useState<PanelTab>('open');
  const [allPairs, setAllPairs] = useState(false);
  const sym = allPairs ? undefined : symbol;

  /** Same-market values use the market's precision; other pairs trim trailing zeros. */
  const fmtP = (o: { symbol: string }, v: string | null) =>
    o.symbol === symbol ? formatPrice(v, tickSize) : formatNumber(v, 8, { trim: true });
  const fmtQ = (o: { symbol: string }, v: string | null) =>
    o.symbol === symbol ? formatQty(v, stepSize) : formatNumber(v, 8, { trim: true, truncate: true });

  const open = useQuery({
    queryKey: qk.openOrders(marketType, sym),
    queryFn: () => (marketType === 'SPOT' ? api.spot.open(sym) : api.futures.open(sym)),
  });

  const history = useInfiniteQuery({
    queryKey: qk.orderHistory(marketType, sym),
    queryFn: ({ pageParam }) => api.orders.history({ marketType, symbol: sym, cursor: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: tab === 'history',
  });

  const fills = useInfiniteQuery({
    queryKey: qk.tradeHistory(marketType, sym),
    queryFn: ({ pageParam }) => api.trades.history({ marketType, symbol: sym, cursor: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: tab === 'trades',
  });

  const cancel = useMutation({
    mutationFn: (id: string) => (marketType === 'SPOT' ? api.spot.cancel(id) : api.futures.cancel(id)),
    onSuccess: (o) => {
      haptics.success();
      toast.success('Order cancelled', `${o.symbol} · ${humanize(o.side)} ${humanize(o.type).toLowerCase()}`);
      void qc.invalidateQueries({ queryKey: qk.orders });
    },
    onError: (e) => {
      haptics.error();
      toast.error('Could not cancel order', errorMessage(e));
      void qc.invalidateQueries({ queryKey: qk.orders });
    },
  });

  const cancelAll = useMutation({
    mutationFn: () => (marketType === 'SPOT' ? api.spot.cancelAll(symbol) : api.orders.cancelAll(symbol)),
    onSuccess: (r) => {
      haptics.success();
      toast.success('Orders cancelled', `${r.cancelled.length} order${r.cancelled.length === 1 ? '' : 's'} cancelled`);
      void qc.invalidateQueries({ queryKey: qk.orders });
    },
    onError: (e) => {
      haptics.error();
      toast.error('Could not cancel orders', errorMessage(e));
    },
  });

  const confirmCancelAll = () => {
    Alert.alert('Cancel all orders?', `All open ${symbol} orders will be cancelled.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel all', style: 'destructive', onPress: () => cancelAll.mutate() },
    ]);
  };

  const openCount = open.data?.length ?? 0;

  const renderOrder = (o: OrderDto, cancellable: boolean) => (
    <View key={o.id} style={s.item}>
      <View style={s.itemHead}>
        <Txt variant="label" weight="semibold">
          {o.symbol}
        </Txt>
        <Badge
          label={
            o.side === 'BUY' ? (marketType === 'FUTURES' ? 'LONG' : 'BUY') : marketType === 'FUTURES' ? 'SHORT' : 'SELL'
          }
          tone={o.side === 'BUY' ? 'up' : 'down'}
        />
        <Txt variant="caption" tone="muted" style={s.flex}>
          {humanize(o.type)}
          {o.reduceOnly ? ' · Reduce-only' : ''}
        </Txt>
        {cancellable ? (
          <Button
            title="Cancel"
            size="sm"
            variant="outline"
            loading={cancel.isPending && cancel.variables === o.id}
            onPress={() => cancel.mutate(o.id)}
          />
        ) : (
          <Badge label={humanize(o.status)} tone={statusTone(o.status)} />
        )}
      </View>
      <View style={s.grid}>
        <Cell label={o.stopPrice ? 'Trigger / Price' : 'Price'}>
          {o.stopPrice ? `${fmtP(o, o.stopPrice)} / ` : ''}
          {o.price ? fmtP(o, o.price) : 'Market'}
        </Cell>
        <Cell label="Filled / Amount" align="center">
          {fmtQ(o, o.filledQuantity)} /{' '}
          {o.quantity ? fmtQ(o, o.quantity) : o.quoteQuantity ? `${formatNumber(o.quoteQuantity, 2)} (quote)` : '—'}
        </Cell>
        <Cell label={cancellable ? 'Created' : 'Avg price'} align="right">
          {cancellable ? fmtDateTime(o.createdAt) : o.avgPrice ? fmtP(o, o.avgPrice) : '—'}
        </Cell>
      </View>
      {!cancellable ? (
        <Txt variant="micro" tone="faint" style={s.time}>
          {fmtDateTime(o.updatedAt)}
          {o.rejectReason ? ` · ${o.rejectReason}` : ''}
        </Txt>
      ) : null}
    </View>
  );

  const renderFill = (f: FillDto) => (
    <View key={f.id} style={s.item}>
      <View style={s.itemHead}>
        <Txt variant="label" weight="semibold">
          {f.symbol}
        </Txt>
        <Badge label={f.side} tone={f.side === 'BUY' ? 'up' : 'down'} />
        <Txt variant="caption" tone="muted" style={s.flex}>
          {f.isMaker ? 'Maker' : 'Taker'}
        </Txt>
        <Txt variant="micro" tone="faint">
          {fmtDateTime(f.ts)}
        </Txt>
      </View>
      <View style={s.grid}>
        <Cell label="Price">{fmtP(f, f.price)}</Cell>
        <Cell label="Amount" align="center">
          {fmtQ(f, f.qty)}
        </Cell>
        <Cell label="Fee" align="right">
          {formatNumber(f.fee, 8, { trim: true })} {f.feeAsset}
        </Cell>
      </View>
      {f.realizedPnl && marketType === 'FUTURES' ? (
        <View style={s.pnl}>
          <Txt variant="micro" tone="faint">
            Realized PnL{' '}
          </Txt>
          <PnLText variant="micro" value={f.realizedPnl} />
        </View>
      ) : null}
    </View>
  );

  const body = () => {
    if (tab === 'open') {
      if (open.isPending) return <SkeletonRows count={3} avatar={false} />;
      if (open.isError) return <ErrorState compact error={open.error} onRetry={() => void open.refetch()} />;
      if (!open.data.length)
        return (
          <EmptyState
            compact
            icon="list"
            title="No open orders"
            message="Limit and stop orders you place appear here."
          />
        );
      return open.data.map((o, i) => (
        <View key={o.id}>
          {i > 0 ? <Divider /> : null}
          {renderOrder(o, true)}
        </View>
      ));
    }
    const q = tab === 'history' ? history : fills;
    if (q.isPending) return <SkeletonRows count={3} avatar={false} />;
    if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />;
    const items = tab === 'history' ? (history.data?.pages.flatMap((p) => p.items) ?? []) : [];
    const trades = tab === 'trades' ? (fills.data?.pages.flatMap((p) => p.items) ?? []) : [];
    const empty = tab === 'history' ? items.length === 0 : trades.length === 0;
    if (empty) {
      return <EmptyState compact icon="history" title={tab === 'history' ? 'No orders yet' : 'No trades yet'} />;
    }
    return (
      <>
        {tab === 'history'
          ? items.map((o, i) => (
              <View key={o.id}>
                {i > 0 ? <Divider /> : null}
                {renderOrder(o, false)}
              </View>
            ))
          : trades.map((f, i) => (
              <View key={f.id}>
                {i > 0 ? <Divider /> : null}
                {renderFill(f)}
              </View>
            ))}
        {q.hasNextPage ? (
          <Button
            title="Load more"
            variant="ghost"
            size="sm"
            loading={q.isFetchingNextPage}
            onPress={() => void q.fetchNextPage()}
            style={s.more}
          />
        ) : null}
      </>
    );
  };

  return (
    <Card padded={false} style={s.card}>
      <View style={s.head}>
        <Tabs
          scrollable
          options={[
            { value: 'open', label: 'Open orders', count: openCount },
            { value: 'history', label: 'Order history' },
            { value: 'trades', label: 'Trade history' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <View style={s.filters}>
        <Checkbox checked={allPairs} onChange={setAllPairs} label="All pairs" />
        {tab === 'open' && !allPairs && openCount > 1 ? (
          <Pressable accessibilityRole="button" onPress={confirmCancelAll} hitSlop={8} disabled={cancelAll.isPending}>
            <Txt variant="label" color={t.colors.down}>
              Cancel all
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <Divider />
      <View style={s.body}>{body()}</View>
    </Card>
  );
}

function Cell({
  label,
  children,
  align = 'left',
}: {
  label: string;
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
}) {
  const s = useStyles();
  return (
    <View style={[s.cell, { alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }]}>
      <Txt variant="micro" tone="faint">
        {label}
      </Txt>
      <Txt variant="caption" numeric numberOfLines={1} style={s.cellValue}>
        {children}
      </Txt>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: {
    marginTop: 12,
  },
  head: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  item: {
    paddingVertical: 12,
  },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flex: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    marginTop: 8,
  },
  cell: {
    flex: 1,
  },
  cellValue: {
    marginTop: 2,
  },
  time: {
    marginTop: 6,
  },
  pnl: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  more: {
    alignSelf: 'center',
    marginVertical: 8,
  },
}));
