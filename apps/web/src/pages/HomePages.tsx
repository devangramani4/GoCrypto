import { D } from '@gocrypto/trading-utils';
import { Card, DataTable, Icon, Logo, Skeleton } from '@gocrypto/ui';
import { Link, Navigate, useNavigate } from 'react-router';
import { AssetIcon, AssetLabel, ChangePct, LivePrice } from '../components/common';
import { fmtPrice, formatCompact } from '../lib/format';
import { useSession } from '../stores/session';
import { useMarketRows } from './MarketsPage';

export function HomePage() {
  const status = useSession((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

function Landing() {
  const { rows, isLoading } = useMarketRows('SPOT');
  const navigate = useNavigate();
  const top = [...rows].sort((a, b) => D(b.ticker?.quoteVolume ?? 0).cmp(a.ticker?.quoteVolume ?? 0)).slice(0, 8);
  const hero = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
    .map((s) => rows.find((r) => r.market.symbol === s))
    .filter(Boolean);
  return (
    <div className="landing">
      <section className="landing__hero">
        <div className="landing__copy">
          <span className="gc-badge gc-badge--brand">Sandbox · paper trading</span>
          <h1>
            Trade crypto like a pro.
            <br />
            <span className="grad">Spot, perpetuals &amp; options.</span>
          </h1>
          <p className="muted">
            A full exchange stack — price-time priority matching, real-time risk engine, TradingView-style charts and
            live order books — on web, desktop and mobile. Practice with simulated funds before anything else.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Link to="/register" className="gc-btn gc-btn--primary gc-btn--lg">
              Create free account
            </Link>
            <Link to="/trade/BTCUSDT" className="gc-btn gc-btn--lg">
              Explore the terminal <Icon name="arrowUpRight" size={15} />
            </Link>
          </div>
        </div>
        <div className="landing__tickers">
          {isLoading
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={92} />)
            : hero.map((r) => (
                <Link key={r!.market.symbol} to={`/trade/${r!.market.symbol}`} className="hero-ticker">
                  <span className="row" style={{ gap: 8 }}>
                    <AssetIcon asset={r!.market.base} size={26} />
                    <strong>{r!.market.base}</strong>
                    <span className="faint">/{r!.market.quote}</span>
                  </span>
                  <LivePrice
                    value={r!.ticker?.lastPrice}
                    text={r!.ticker ? fmtPrice(r!.ticker.lastPrice, r!.market) : '—'}
                    className="hero-ticker__price"
                  />
                  <span className="row" style={{ justifyContent: 'space-between' }}>
                    <ChangePct value={r!.ticker?.priceChangePercent} />
                    <span className="faint num">Vol {formatCompact(r!.ticker?.quoteVolume ?? '0')}</span>
                  </span>
                </Link>
              ))}
        </div>
      </section>

      <section className="landing__section">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Popular markets</h2>
          <Link to="/markets">All markets →</Link>
        </div>
        <Card noPadding>
          <DataTable
            rows={top}
            rowKey={(r) => r.market.symbol}
            loading={isLoading}
            onRowClick={(r) => navigate(`/trade/${r.market.symbol}`)}
            columns={[
              {
                key: 'm',
                header: 'Market',
                render: (r) => <AssetLabel asset={r.market.base} sub={`${r.market.base}/${r.market.quote}`} />,
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
                header: '24h change',
                align: 'right',
                render: (r) => <ChangePct value={r.ticker?.priceChangePercent} />,
              },
              {
                key: 'v',
                header: '24h volume',
                align: 'right',
                render: (r) => <span className="num">{formatCompact(r.ticker?.quoteVolume ?? '0')}</span>,
              },
              { key: 't', header: '', align: 'right', render: () => <span className="gc-btn gc-btn--sm">Trade</span> },
            ]}
          />
        </Card>
      </section>

      <section className="landing__section landing__features">
        {[
          {
            icon: 'candles' as const,
            title: 'Spot trading',
            body: 'Limit, market, stop-limit, stop-market and OCO orders with post-only, IOC and FOK.',
          },
          {
            icon: 'bolt' as const,
            title: 'Perpetual futures',
            body: 'USDT-margined, cross & isolated margin, tiered leverage, TP/SL, reduce-only and funding.',
          },
          {
            icon: 'layers' as const,
            title: 'Options',
            body: 'Calls and puts with a live chain — bid/ask, IV and full Greeks, trade straight from the chain.',
          },
          {
            icon: 'shield' as const,
            title: 'Security first',
            body: 'TOTP 2FA, trading PIN, device & session control, withdrawal limits and risk review.',
          },
          {
            icon: 'activity' as const,
            title: 'Real-time everything',
            body: 'WebSocket order books, trades, candles, balances and positions — no refresh needed.',
          },
          {
            icon: 'monitor' as const,
            title: 'Every platform',
            body: 'Responsive web, a multi-panel desktop app for Windows, macOS & Linux, and iOS/Android apps.',
          },
        ].map((f) => (
          <div key={f.title} className="feature">
            <span className="feature__icon">
              <Icon name={f.icon} size={18} />
            </span>
            <h3>{f.title}</h3>
            <p className="muted">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="landing__footer">
        <Logo size={22} />
        <p className="faint">
          Risk warning: digital asset prices are volatile and leveraged products can result in losses exceeding your
          margin. This deployment runs in sandbox mode with simulated balances. Real-money operation requires custody,
          licensing, KYC/AML and tax review for every jurisdiction served.
        </p>
      </footer>
    </div>
  );
}
