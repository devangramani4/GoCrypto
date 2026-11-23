import type { MarketDto, MarketType, TickerDto } from '@gocrypto/shared-types';
import { D, formatCompact } from '@gocrypto/trading-utils';
import { Card, DataTable, Icon, Tabs, cx, type Column } from '@gocrypto/ui';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AssetIcon, ChangePct, LivePrice } from '../components/common';
import { fmtPrice } from '../lib/format';
import { useMarkets, useTickers } from '../lib/hooks';
import { usePrefs } from '../stores/session';

type Row = { market: MarketDto; ticker?: TickerDto };
type SortKey = 'symbol' | 'price' | 'change' | 'volume' | 'funding' | 'oi';

export function useMarketRows(type: MarketType) {
  const { data: markets, isLoading, error, refetch } = useMarkets(type);
  const { data: tickers } = useTickers(type);
  const rows = useMemo<Row[]>(() => {
    const tmap = new Map((tickers ?? []).map((t) => [t.symbol, t]));
    return (markets ?? [])
      .filter((m) => m.status === 'TRADING')
      .map((m) => ({ market: m, ticker: tmap.get(m.symbol) }));
  }, [markets, tickers]);
  return { rows, isLoading, error, refetch };
}

function TopCard({
  title,
  icon,
  rows,
  metric,
}: {
  title: string;
  icon: Parameters<typeof Icon>[0]['name'];
  rows: Row[];
  metric: (r: Row) => React.ReactNode;
}) {
  return (
    <Card
      title={
        <span className="row" style={{ gap: 8 }}>
          <Icon name={icon} size={15} /> <strong>{title}</strong>
        </span>
      }
      className="top-card"
    >
      {rows.slice(0, 4).map((r) => (
        <Link
          key={r.market.symbol}
          to={r.market.type === 'FUTURES' ? `/futures/${r.market.symbol}` : `/trade/${r.market.symbol}`}
          className="top-card__row"
        >
          <span className="row" style={{ gap: 8 }}>
            <AssetIcon asset={r.market.base} size={20} />
            <strong>{r.market.base}</strong>
            <span className="faint">{r.market.type === 'FUTURES' ? 'PERP' : r.market.quote}</span>
          </span>
          <span className="num">{r.ticker ? fmtPrice(r.ticker.lastPrice, r.market) : '—'}</span>
          {metric(r)}
        </Link>
      ))}
      {rows.length === 0 && <div className="gc-state">—</div>}
    </Card>
  );
}

export function MarketsPage() {
  const [type, setType] = useState<'SPOT' | 'FUTURES' | 'FAV'>('SPOT');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'volume', dir: -1 });
  const favorites = usePrefs((s) => s.favorites);
  const toggleFavorite = usePrefs((s) => s.toggleFavorite);
  const navigate = useNavigate();
  const spot = useMarketRows('SPOT');
  const futures = useMarketRows('FUTURES');
  const all = useMemo(() => [...spot.rows, ...futures.rows], [spot.rows, futures.rows]);
  const base =
    type === 'FAV'
      ? all.filter((r) => favorites.includes(r.market.symbol))
      : type === 'SPOT'
        ? spot.rows
        : futures.rows;

  const usdVol = (r: Row) => D(r.ticker?.quoteVolume ?? 0);
  const rows = useMemo(() => {
    const filtered = base.filter(
      (r) => !q || r.market.symbol.includes(q.toUpperCase()) || r.market.base.includes(q.toUpperCase()),
    );
    const val = (r: Row): number | string => {
      switch (sort.key) {
        case 'symbol':
          return r.market.symbol;
        case 'price':
          return Number(r.ticker?.lastPrice ?? 0);
        case 'change':
          return Number(r.ticker?.priceChangePercent ?? 0);
        case 'funding':
          return Number(r.ticker?.fundingRate ?? 0);
        case 'oi':
          return Number(r.ticker?.openInterest ?? 0) * Number(r.ticker?.lastPrice ?? 0);
        default:
          return usdVol(r).toNumber();
      }
    };
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
    });
  }, [base, q, sort]);

  const byChange = [...all]
    .filter((r) => r.ticker)
    .sort((a, b) => Number(b.ticker!.priceChangePercent) - Number(a.ticker!.priceChangePercent));
  const byVolume = [...all].sort((a, b) => usdVol(b).cmp(usdVol(a)));

  const head = (label: string, key: SortKey) => (
    <button
      type="button"
      className={cx('sort-head', sort.key === key && 'on')}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}
    >
      {label}
      {sort.key === key && <span aria-hidden="true">{sort.dir === -1 ? ' ↓' : ' ↑'}</span>}
    </button>
  );

  const isFutures = type === 'FUTURES';
  const columns: Column<Row>[] = [
    {
      key: 'fav',
      header: '',
      width: 32,
      render: (r) => (
        <button
          type="button"
          className={cx('mlist__star', favorites.includes(r.market.symbol) && 'on')}
          aria-label="Toggle favorite"
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(r.market.symbol);
          }}
        >
          <Icon name="star" size={13} />
        </button>
      ),
    },
    {
      key: 'symbol',
      header: head('Market', 'symbol'),
      render: (r) => (
        <span className="row" style={{ gap: 10 }}>
          <AssetIcon asset={r.market.base} size={24} />
          <span className="col" style={{ gap: 0 }}>
            <strong>
              {r.market.type === 'FUTURES'
                ? r.market.symbol.replace('-PERP', '')
                : `${r.market.base}/${r.market.quote}`}
            </strong>
            <span className="faint" style={{ fontSize: 11 }}>
              {r.market.type === 'FUTURES' ? `Perpetual · up to ${r.market.futures?.maxLeverage ?? ''}x` : 'Spot'}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'price',
      header: head('Last price', 'price'),
      align: 'right',
      render: (r) =>
        r.ticker ? <LivePrice value={r.ticker.lastPrice} text={fmtPrice(r.ticker.lastPrice, r.market)} /> : '—',
    },
    {
      key: 'change',
      header: head('24h change', 'change'),
      align: 'right',
      render: (r) => <ChangePct value={r.ticker?.priceChangePercent} />,
    },
    {
      key: 'hl',
      header: '24h high / low',
      align: 'right',
      render: (r) => (
        <span className="num muted">
          {r.ticker ? `${fmtPrice(r.ticker.high, r.market)} / ${fmtPrice(r.ticker.low, r.market)}` : '—'}
        </span>
      ),
    },
    {
      key: 'volume',
      header: head('24h volume', 'volume'),
      align: 'right',
      render: (r) => (
        <span className="num">{r.ticker ? `${formatCompact(r.ticker.quoteVolume)} ${r.market.quote}` : '—'}</span>
      ),
    },
  ];
  if (isFutures) {
    columns.push({
      key: 'funding',
      header: head('Funding', 'funding'),
      align: 'right',
      render: (r) => (
        <span className={cx('num', D(r.ticker?.fundingRate ?? 0).gte(0) ? 'warn' : 'up')}>
          {r.ticker?.fundingRate ? `${D(r.ticker.fundingRate).mul(100).toFixed(4)}%` : '—'}
        </span>
      ),
    });
    columns.push({
      key: 'oi',
      header: head('Open interest', 'oi'),
      align: 'right',
      render: (r) => (
        <span className="num">
          {r.ticker?.openInterest ? `${formatCompact(r.ticker.openInterest)} ${r.market.base}` : '—'}
        </span>
      ),
    });
  }
  columns.push({
    key: 'trade',
    header: '',
    align: 'right',
    render: (r) => (
      <Link
        className="gc-btn gc-btn--sm"
        to={r.market.type === 'FUTURES' ? `/futures/${r.market.symbol}` : `/trade/${r.market.symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        Trade
      </Link>
    ),
  });

  const current =
    type === 'SPOT'
      ? spot
      : type === 'FUTURES'
        ? futures
        : { isLoading: spot.isLoading || futures.isLoading, error: spot.error ?? futures.error, refetch: spot.refetch };
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Markets</h1>
          <p className="muted">
            Live prices across spot and perpetual futures. Options are listed on the{' '}
            <Link to="/options">options chain</Link>.
          </p>
        </div>
      </div>
      <div className="top-cards">
        <TopCard
          title="Top gainers"
          icon="trendUp"
          rows={byChange}
          metric={(r) => <ChangePct value={r.ticker?.priceChangePercent} />}
        />
        <TopCard
          title="Top losers"
          icon="trendDown"
          rows={[...byChange].reverse()}
          metric={(r) => <ChangePct value={r.ticker?.priceChangePercent} />}
        />
        <TopCard
          title="Highest volume"
          icon="activity"
          rows={byVolume}
          metric={(r) => <span className="num muted">{formatCompact(r.ticker?.quoteVolume ?? '0')}</span>}
        />
      </div>
      <Card noPadding>
        <div className="markets-toolbar">
          <Tabs
            value={type}
            onChange={setType}
            tabs={[
              { value: 'FAV', label: 'Favorites', count: favorites.length },
              { value: 'SPOT', label: 'Spot' },
              { value: 'FUTURES', label: 'Futures' },
            ]}
          />
          <span className="spacer" />
          <div className="mlist__search" style={{ width: 220 }}>
            <Icon name="search" size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search coin"
              aria-label="Search markets"
            />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.market.symbol}
          loading={current.isLoading}
          error={current.error}
          onRetry={() => void current.refetch()}
          onRowClick={(r) =>
            navigate(r.market.type === 'FUTURES' ? `/futures/${r.market.symbol}` : `/trade/${r.market.symbol}`)
          }
          empty={type === 'FAV' ? 'Star markets to add them to your favorites' : 'No markets match your search'}
          skeletonRows={10}
        />
      </Card>
    </div>
  );
}
