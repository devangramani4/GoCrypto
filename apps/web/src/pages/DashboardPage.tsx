import { D, formatUsd } from '@gocrypto/trading-utils';
import { Alert, Card, DataTable, Icon, Progress, Skeleton, Stat } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AreaChart } from '../components/chart/AreaChart';
import { AssetLabel, ChangePct, LivePrice, PnL } from '../components/common';
import { StatusBadge } from '../components/trading/OrdersPanel';
import { FuturesPositionsTable } from '../components/trading/PositionsTable';
import { api } from '../lib/api';
import { fmtDateTime, fmtPrice, formatNumber, formatPercent } from '../lib/format';
import { useAuthed } from '../lib/hooks';
import { usePrefs, useSession } from '../stores/session';
import { useMarketRows } from './MarketsPage';

export function DashboardPage() {
  const [params] = useSearchParams();
  const user = useSession((s) => s.user);
  const authed = useAuthed();
  const favorites = usePrefs((s) => s.favorites);
  const summary = useQuery({
    queryKey: ['portfolio', 'summary'],
    queryFn: () => api.portfolio.summary(),
    enabled: authed,
    refetchInterval: 30_000,
  });
  const perf = useQuery({
    queryKey: ['portfolio', 'performance', '7d'],
    queryFn: () => api.portfolio.performance('7d'),
    enabled: authed,
  });
  const holdings = useQuery({
    queryKey: ['portfolio', 'holdings'],
    queryFn: () => api.portfolio.holdings(),
    enabled: authed,
  });
  const security = useQuery({ queryKey: ['security'], queryFn: () => api.auth.security(), enabled: authed });
  const recent = useQuery({
    queryKey: ['orders', 'recent'],
    queryFn: () => api.orders.history({ limit: 6 }),
    enabled: authed,
  });
  const notes = useQuery({
    queryKey: ['notifications', 'latest'],
    queryFn: () => api.notifications.list({ limit: 5 }),
    enabled: authed,
  });
  const spot = useMarketRows('SPOT');
  const fut = useMarketRows('FUTURES');
  const watch = [...spot.rows, ...fut.rows].filter((r) => favorites.includes(r.market.symbol)).slice(0, 8);
  const s = summary.data;
  const empty = s && D(s.totalValue).isZero();

  return (
    <div className="page dashboard">
      <div className="page__head">
        <div>
          <h1>Welcome back{user?.displayName ? `, ${user.displayName}` : ''}</h1>
          <p className="muted">
            UID {user?.uid} · VIP {user?.vipTier} ·{' '}
            {user?.emailVerified ? 'Email verified' : <Link to="/account/profile">Verify your email</Link>}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/wallet/deposit" className="gc-btn gc-btn--primary">
            <Icon name="download" size={15} /> Deposit
          </Link>
          <Link to="/wallet/withdraw" className="gc-btn">
            <Icon name="upload" size={15} /> Withdraw
          </Link>
          <Link to="/wallet?transfer=1" className="gc-btn">
            <Icon name="swap" size={15} /> Transfer
          </Link>
        </div>
      </div>

      {(params.get('welcome') || empty) && (
        <Alert tone="info" icon="info">
          Your account is ready. This is a <strong>sandbox</strong>:{' '}
          <Link to="/wallet/deposit">deposit simulated funds</Link>, then try a spot order or open a small futures
          position.
        </Alert>
      )}

      <div className="stats-grid">
        <Card>
          <Stat
            label="Estimated balance"
            icon="wallet"
            loading={summary.isLoading}
            value={s ? formatUsd(s.totalValue) : '—'}
            sub={s ? `Available ${formatUsd(s.availableBalance)}` : undefined}
          />
        </Card>
        <Card>
          <Stat
            label="Today's PnL"
            icon="trendUp"
            loading={summary.isLoading}
            value={s ? <PnL value={s.todayPnl} suffix="USD" /> : '—'}
            sub={s ? formatPercent(s.todayPnlPercent) : undefined}
            subTone={s && D(s.todayPnlPercent).lt(0) ? 'down' : 'up'}
          />
        </Card>
        <Card>
          <Stat
            label="Unrealized PnL"
            icon="activity"
            loading={summary.isLoading}
            value={s ? <PnL value={s.unrealizedPnl} suffix="USD" /> : '—'}
            sub={s ? `Margin in use ${formatUsd(s.usedMargin)}` : undefined}
          />
        </Card>
        <Card>
          <Stat
            label="Open orders · positions"
            icon="list"
            loading={summary.isLoading}
            value={s ? `${s.openOrders} · ${s.openPositions}` : '—'}
            sub={<Link to="/orders">View orders</Link>}
          />
        </Card>
      </div>

      <div className="dash-grid">
        <Card
          title="Balance — last 7 days"
          actions={<Link to="/portfolio">Portfolio →</Link>}
          className="dash-grid__perf"
        >
          {perf.isLoading ? (
            <Skeleton height={220} />
          ) : perf.data && perf.data.length > 1 ? (
            <AreaChart points={perf.data} />
          ) : (
            <div className="gc-state">Performance appears after your first day of activity.</div>
          )}
        </Card>
        <Card title="Account security" className="dash-grid__sec">
          {security.data ? (
            <div className="col" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Security score</span>
                <strong className="num">{security.data.securityScore}/100</strong>
              </div>
              <Progress
                value={security.data.securityScore}
                tone={security.data.securityScore >= 70 ? 'up' : security.data.securityScore >= 40 ? 'warn' : 'down'}
              />
              {[
                { ok: security.data.emailVerified, label: 'Email verified', to: '/account/profile' },
                { ok: security.data.twoFactorEnabled, label: 'Two-factor authentication', to: '/account/security' },
                { ok: security.data.hasTradingPin, label: 'Trading / withdrawal PIN', to: '/account/security' },
                { ok: security.data.antiPhishingCodeSet, label: 'Anti-phishing code', to: '/account/profile' },
              ].map((c) => (
                <Link key={c.label} to={c.to} className="check-row">
                  <Icon name={c.ok ? 'check' : 'alert'} size={14} className={c.ok ? 'up' : 'warn'} />
                  <span>{c.label}</span>
                  <span className="spacer" />
                  <span className="faint">{c.ok ? 'On' : 'Set up →'}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Skeleton height={150} />
          )}
        </Card>
        <Card title="Spot holdings" actions={<Link to="/wallet">Wallet →</Link>} noPadding className="dash-grid__hold">
          <DataTable
            rows={holdings.data?.slice(0, 6)}
            rowKey={(h) => h.asset}
            loading={holdings.isLoading}
            empty="No assets yet"
            columns={[
              {
                key: 'a',
                header: 'Asset',
                render: (h) => <AssetLabel asset={h.asset} sub={formatNumber(h.quantity, 8, { trim: true })} />,
              },
              {
                key: 'p',
                header: 'Price',
                align: 'right',
                render: (h) => <span className="num">{fmtPrice(h.price)}</span>,
              },
              { key: 'c', header: '24h', align: 'right', render: (h) => <ChangePct value={h.change24h} /> },
              {
                key: 'v',
                header: 'Value',
                align: 'right',
                render: (h) => <span className="num">{formatUsd(h.usdValue)}</span>,
              },
            ]}
          />
        </Card>
        <Card title="Watchlist" actions={<Link to="/markets">Markets →</Link>} noPadding className="dash-grid__watch">
          <DataTable
            rows={watch}
            rowKey={(r) => r.market.symbol}
            empty="Star markets to build your watchlist"
            columns={[
              {
                key: 'm',
                header: 'Market',
                render: (r) => (
                  <Link
                    to={r.market.type === 'FUTURES' ? `/futures/${r.market.symbol}` : `/trade/${r.market.symbol}`}
                    className="strong-link"
                  >
                    {r.market.type === 'FUTURES' ? r.market.symbol : `${r.market.base}/${r.market.quote}`}
                  </Link>
                ),
              },
              {
                key: 'p',
                header: 'Price',
                align: 'right',
                render: (r) =>
                  r.ticker ? (
                    <LivePrice value={r.ticker.lastPrice} text={fmtPrice(r.ticker.lastPrice, r.market)} />
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'c',
                header: '24h',
                align: 'right',
                render: (r) => <ChangePct value={r.ticker?.priceChangePercent} />,
              },
            ]}
          />
        </Card>
        <Card
          title="Open positions"
          actions={<Link to="/futures/BTCUSDT-PERP">Futures →</Link>}
          noPadding
          className="dash-grid__pos"
        >
          <FuturesPositionsTable compact />
        </Card>
        <Card
          title="Recent orders"
          actions={<Link to="/orders">All orders →</Link>}
          noPadding
          className="dash-grid__orders"
        >
          <DataTable
            rows={recent.data?.items}
            rowKey={(o) => o.id}
            loading={recent.isLoading}
            empty="No orders yet"
            columns={[
              { key: 's', header: 'Market', render: (o) => <strong>{o.symbol}</strong> },
              {
                key: 'd',
                header: 'Side',
                render: (o) => <span className={o.side === 'BUY' ? 'up' : 'down'}>{o.side}</span>,
              },
              {
                key: 'q',
                header: 'Filled',
                align: 'right',
                render: (o) => <span className="num">{formatNumber(o.filledQuantity, 6, { trim: true })}</span>,
              },
              { key: 'st', header: 'Status', align: 'right', render: (o) => <StatusBadge status={o.status} /> },
            ]}
          />
        </Card>
        <Card title="Notifications" actions={<Link to="/notifications">All →</Link>} className="dash-grid__notes">
          {notes.isLoading ? (
            <Skeleton height={120} />
          ) : notes.data?.items.length ? (
            <ul className="note-list">
              {notes.data.items.map((n) => (
                <li key={n.id} className={n.read ? '' : 'unread'}>
                  <strong>{n.title}</strong>
                  <span className="muted">{n.body}</span>
                  <span className="faint">{fmtDateTime(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="gc-state">You&apos;re all caught up</div>
          )}
        </Card>
      </div>
    </div>
  );
}
