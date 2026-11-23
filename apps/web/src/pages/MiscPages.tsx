import type {
  LiquidationDto,
  MarketType,
  NotificationCategory,
  NotificationDto,
  OptionSettlementDto,
} from '@gocrypto/shared-types';
import { formatNumber, formatPercent } from '@gocrypto/trading-utils';
import { Badge, Button, Card, DataTable, EmptyState, Icon, Tabs, cx, useToast } from '@gocrypto/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { PnL } from '../components/common';
import {
  FundingHistoryTable,
  OpenOrdersTable,
  OrderHistoryTable,
  TradeHistoryTable,
} from '../components/trading/OrdersPanel';
import { api, errorMessage } from '../lib/api';
import { fmtDateTime, fmtPrice, humanize } from '../lib/format';
import { useAssets, useAuthed, useMarkets } from '../lib/hooks';

type OrdersTab = 'open' | 'history' | 'trades' | 'funding' | 'liquidations' | 'settlements';

export function OrdersPage() {
  const [tab, setTab] = useState<OrdersTab>('open');
  const [type, setType] = useState<MarketType | 'ALL'>('ALL');
  const authed = useAuthed();
  const mt = type === 'ALL' ? undefined : type;
  const liquidations = useQuery({
    queryKey: ['liquidations'],
    queryFn: () => api.futures.liquidations(),
    enabled: authed && tab === 'liquidations',
  });
  const settlements = useQuery({
    queryKey: ['option-settlements'],
    queryFn: () => api.options.settlements(),
    enabled: authed && tab === 'settlements',
  });
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Orders &amp; trades</h1>
          <p className="muted">
            Complete lifecycle of every order: NEW → OPEN → PARTIALLY_FILLED → FILLED, CANCELLED, REJECTED or EXPIRED.
          </p>
        </div>
      </div>
      <Card noPadding>
        <div className="markets-toolbar">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'open', label: 'Open orders' },
              { value: 'history', label: 'Order history' },
              { value: 'trades', label: 'Trade history' },
              { value: 'funding', label: 'Funding' },
              { value: 'liquidations', label: 'Liquidations' },
              { value: 'settlements', label: 'Option settlements' },
            ]}
          />
          <span className="spacer" />
          {(tab === 'open' || tab === 'history' || tab === 'trades') && (
            <Tabs
              variant="pills"
              value={type}
              onChange={setType}
              tabs={[
                { value: 'ALL', label: 'All' },
                { value: 'SPOT', label: 'Spot' },
                { value: 'FUTURES', label: 'Futures' },
                { value: 'OPTIONS', label: 'Options' },
              ]}
            />
          )}
        </div>
        {tab === 'open' ? (
          type === 'ALL' ? (
            <>
              <h4 className="section-label">Spot</h4>
              <OpenOrdersTable marketType="SPOT" />
              <h4 className="section-label">Futures</h4>
              <OpenOrdersTable marketType="FUTURES" />
              <h4 className="section-label">Options</h4>
              <OpenOrdersTable marketType="OPTIONS" />
            </>
          ) : (
            <OpenOrdersTable marketType={type} />
          )
        ) : tab === 'history' ? (
          <OrderHistoryTable marketType={mt} />
        ) : tab === 'trades' ? (
          <TradeHistoryTable marketType={mt} />
        ) : tab === 'funding' ? (
          <FundingHistoryTable />
        ) : tab === 'liquidations' ? (
          <DataTable<LiquidationDto>
            rows={liquidations.data}
            rowKey={(l) => l.id}
            loading={liquidations.isLoading}
            error={liquidations.error}
            empty="No liquidations — keep it that way with stop-losses and sensible leverage."
            columns={[
              {
                key: 't',
                header: 'Time',
                render: (l) => <span className="muted num">{fmtDateTime(l.createdAt)}</span>,
              },
              { key: 's', header: 'Contract', render: (l) => <strong>{l.symbol}</strong> },
              {
                key: 'd',
                header: 'Side',
                render: (l) => <Badge tone={l.side === 'LONG' ? 'up' : 'down'}>{l.side}</Badge>,
              },
              {
                key: 'q',
                header: 'Quantity',
                align: 'right',
                render: (l) => <span className="num">{l.quantity}</span>,
              },
              {
                key: 'e',
                header: 'Entry / Mark',
                align: 'right',
                render: (l) => <span className="num">{`${fmtPrice(l.entryPrice)} / ${fmtPrice(l.markPrice)}`}</span>,
              },
              { key: 'm', header: 'Mode', render: (l) => humanize(l.marginMode) },
              { key: 'l', header: 'Loss', align: 'right', render: (l) => <PnL value={`-${l.loss}`} suffix="USDT" /> },
              {
                key: 'f',
                header: 'Liquidation fee',
                align: 'right',
                render: (l) => <span className="num muted">{formatNumber(l.fee, 4)}</span>,
              },
            ]}
          />
        ) : (
          <DataTable<OptionSettlementDto>
            rows={settlements.data}
            rowKey={(s) => s.id}
            loading={settlements.isLoading}
            error={settlements.error}
            empty="No expired option positions yet"
            columns={[
              {
                key: 't',
                header: 'Settled',
                render: (s) => <span className="muted num">{fmtDateTime(s.createdAt)}</span>,
              },
              { key: 's', header: 'Contract', render: (s) => <strong>{s.symbol}</strong> },
              {
                key: 'd',
                header: 'Side',
                render: (s) => <Badge tone={s.side === 'LONG' ? 'up' : 'down'}>{s.side}</Badge>,
              },
              {
                key: 'q',
                header: 'Quantity',
                align: 'right',
                render: (s) => <span className="num">{s.quantity}</span>,
              },
              {
                key: 'k',
                header: 'Strike / Settlement',
                align: 'right',
                render: (s) => <span className="num">{`${fmtPrice(s.strike)} / ${fmtPrice(s.settlementPrice)}`}</span>,
              },
              { key: 'p', header: 'Payout', align: 'right', render: (s) => <PnL value={s.payout} suffix="USDT" /> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

const CATEGORY_ICON: Record<NotificationCategory, Parameters<typeof Icon>[0]['name']> = {
  TRADING: 'candles',
  WALLET: 'wallet',
  SECURITY: 'shield',
  SYSTEM: 'info',
};

export function NotificationsPage() {
  const authed = useAuthed();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const qc = useQueryClient();
  const toast = useToast();
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list', filter],
    queryFn: ({ pageParam }) => api.notifications.list({ cursor: pageParam, limit: 30, unread: filter === 'unread' }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: authed,
  });
  const markAll = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: (r) => {
      toast.success(`Marked ${r.updated} as read`);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="page page--narrow">
      <div className="page__head">
        <div>
          <h1>Notifications</h1>
          <p className="muted">
            Trading, wallet and security alerts. Choose channels in <Link to="/account/preferences">preferences</Link>.
          </p>
        </div>
        <Button onClick={() => markAll.mutate()} loading={markAll.isPending} icon="check">
          Mark all as read
        </Button>
      </div>
      <Card noPadding>
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
          ]}
        />
        {q.isLoading ? (
          <div className="gc-state">Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState icon="bell" title="No notifications" description="You're all caught up." />
        ) : (
          <ul className="notifications">
            {items.map((n: NotificationDto) => (
              <li key={n.id} className={cx('notification', !n.read && 'unread')}>
                <span className={`notification__icon cat-${n.category.toLowerCase()}`}>
                  <Icon name={CATEGORY_ICON[n.category]} size={16} />
                </span>
                <div className="notification__body">
                  <strong>{n.title}</strong>
                  <p className="muted">{n.body}</p>
                  <span className="faint">{fmtDateTime(n.createdAt)}</span>
                </div>
                {!n.read && (
                  <button type="button" className="link-btn" onClick={() => markOne.mutate(n.id)}>
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {q.hasNextPage && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
            <Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export function FeesPage() {
  const { data: markets, isLoading } = useMarkets();
  const { data: assets, isLoading: assetsLoading } = useAssets();
  const byType = (t: MarketType) => (markets ?? []).filter((m) => m.type === t && m.status === 'TRADING');
  const first = (t: MarketType) => byType(t)[0];
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Fees</h1>
          <p className="muted">
            Base trading fees per product. VIP tiers and individual rates are configured by the exchange and applied
            automatically at execution.
          </p>
        </div>
      </div>
      <div className="stats-grid">
        {(['SPOT', 'FUTURES', 'OPTIONS'] as MarketType[]).map((t) => (
          <Card key={t} title={humanize(t)}>
            {first(t) ? (
              <div className="fee-card">
                <div>
                  <span className="faint">Maker</span>
                  <strong className="num">{formatPercent(first(t)!.makerFeeRate, 3, false)}</strong>
                </div>
                <div>
                  <span className="faint">Taker</span>
                  <strong className="num">{formatPercent(first(t)!.takerFeeRate, 3, false)}</strong>
                </div>
              </div>
            ) : (
              <span className="faint">{isLoading ? 'Loading…' : 'No active markets'}</span>
            )}
          </Card>
        ))}
      </div>
      <Card title="Withdrawal fees" noPadding>
        <DataTable
          loading={assetsLoading}
          rows={(assets ?? []).flatMap((a) => a.networks.map((n) => ({ a, n })))}
          rowKey={(r) => `${r.a.symbol}-${r.n.code}`}
          columns={[
            { key: 'a', header: 'Coin', render: (r) => <strong>{r.a.symbol}</strong> },
            { key: 'n', header: 'Network', render: (r) => r.n.name },
            {
              key: 'f',
              header: 'Withdrawal fee',
              align: 'right',
              render: (r) => <span className="num">{formatNumber(r.n.withdrawalFee, 8, { trim: true })}</span>,
            },
            {
              key: 'm',
              header: 'Min. withdrawal',
              align: 'right',
              render: (r) => <span className="num">{formatNumber(r.n.minWithdrawal, 8, { trim: true })}</span>,
            },
            {
              key: 'd',
              header: 'Min. deposit',
              align: 'right',
              render: (r) => <span className="num">{formatNumber(r.n.minDeposit, 8, { trim: true })}</span>,
            },
            {
              key: 'c',
              header: 'Confirmations',
              align: 'right',
              render: (r) => <span className="num">{r.n.confirmations}</span>,
            },
          ]}
        />
      </Card>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="page-center">
      <EmptyState
        icon="globe"
        title="Page not found"
        description="The page you are looking for doesn't exist or has moved."
        action={
          <Link to="/" className="gc-btn gc-btn--primary">
            Go home
          </Link>
        }
      />
    </div>
  );
}
