import type { MarketDto, MarketType, TickerDto } from '@gocrypto/shared-types';
import { D, formatCompact, formatNumber } from '@gocrypto/trading-utils';
import { Icon, Skeleton, cx } from '@gocrypto/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { fmtCountdown, fmtPrice, fmtTime, formatPercent } from '../../lib/format';
import { useMarkets, useNow, useRecentTrades, useTicker, useTickers } from '../../lib/hooks';
import { usePrefs } from '../../stores/session';
import { AssetIcon, ChangePct, LivePrice } from '../common';

export function RecentTrades({ market }: { market: MarketDto }) {
  const trades = useRecentTrades(market.symbol, 60);
  return (
    <div className="trades">
      <div className="ob__head">
        <span>Price ({market.quote})</span>
        <span>Amount</span>
        <span>Time</span>
      </div>
      <div className="trades__list">
        {!trades
          ? Array.from({ length: 12 }, (_, i) => <Skeleton key={i} height={12} style={{ margin: '6px 10px', width: 'auto' }} />)
          : trades.map((t) => (
              <div key={t.id} className="trades__row num">
                <span className={t.side === 'BUY' ? 'up' : 'down'}>{fmtPrice(t.price, market)}</span>
                <span>{formatNumber(t.qty, market.qtyPrecision, { truncate: true })}</span>
                <span className="muted">{fmtTime(t.ts, false)}</span>
              </div>
            ))}
        {trades && trades.length === 0 && <div className="gc-state">No trades yet</div>}
      </div>
    </div>
  );
}

function FundingCountdown({ next }: { next: number }) {
  const now = useNow(1000);
  return <span className="num">{fmtCountdown(next - now)}</span>;
}

export function MarketHeader({ market, kind }: { market: MarketDto; kind: 'spot' | 'futures' }) {
  const { data: t } = useTicker(market.symbol);
  const stats: [string, React.ReactNode][] = [];
  if (t) {
    stats.push(['24h Change', <span key="c" className={D(t.priceChange).gte(0) ? 'up' : 'down'}>{`${D(t.priceChange).gte(0) ? '+' : ''}${fmtPrice(t.priceChange, market)} ${formatPercent(t.priceChangePercent)}`}</span>]);
    if (kind === 'futures') {
      stats.push(['Mark', fmtPrice(t.markPrice ?? null, market)]);
      stats.push(['Index', fmtPrice(t.indexPrice ?? null, market)]);
      stats.push([
        'Funding / Countdown',
        <span key="f">
          <span className={D(t.fundingRate ?? 0).gte(0) ? 'warn' : 'up'}>{t.fundingRate ? `${D(t.fundingRate).mul(100).toFixed(4)}%` : '—'}</span>
          {' / '}
          {t.nextFundingTime ? <FundingCountdown next={t.nextFundingTime} /> : '—'}
        </span>,
      ]);
    }
    stats.push(['24h High', fmtPrice(t.high, market)]);
    stats.push(['24h Low', fmtPrice(t.low, market)]);
    stats.push([`24h Vol (${market.base})`, formatCompact(t.volume)]);
    stats.push([`24h Vol (${market.quote})`, formatCompact(t.quoteVolume)]);
    if (kind === 'futures') stats.push([`Open Interest (${market.base})`, formatCompact(t.openInterest ?? '0')]);
  }
  return (
    <div className="mkt-head">
      <MarketSelector market={market} kind={kind} />
      <div className="mkt-head__price">
        <LivePrice value={t?.lastPrice} text={t ? fmtPrice(t.lastPrice, market) : '—'} className={cx('mkt-head__last', t && (D(t.priceChange).gte(0) ? 'up' : 'down'))} />
        <span className="faint num" style={{ fontSize: 11 }}>
          {t ? `≈ $${fmtPrice(t.lastPrice, market)}` : ''}
        </span>
      </div>
      <div className="mkt-head__stats">
        {t
          ? stats.map(([k, v]) => (
              <div key={k} className="mkt-head__stat">
                <span className="faint">{k}</span>
                <span className="num">{v}</span>
              </div>
            ))
          : Array.from({ length: 5 }, (_, i) => <Skeleton key={i} width={90} height={26} />)}
      </div>
    </div>
  );
}

export function MarketSelector({ market, kind }: { market: MarketDto; kind: 'spot' | 'futures' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="mkt-sel" ref={ref}>
      <button type="button" className="mkt-sel__btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <AssetIcon asset={market.base} size={26} />
        <span className="col" style={{ gap: 0, alignItems: 'flex-start' }}>
          <strong>{kind === 'futures' ? market.symbol.replace('-PERP', '') : `${market.base}/${market.quote}`}</strong>
          <span className="faint" style={{ fontSize: 11 }}>
            {kind === 'futures' ? 'Perpetual' : market.base}
          </span>
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="mkt-sel__pop">
          <MarketList type={kind === 'futures' ? 'FUTURES' : 'SPOT'} onSelect={() => setOpen(false)} active={market.symbol} />
        </div>
      )}
    </div>
  );
}

/** Searchable market list (selector popover and the desktop market panel). */
export function MarketList({ type, active, onSelect, compact }: { type: MarketType; active?: string; onSelect?: (symbol: string) => void; compact?: boolean }) {
  const { data: markets } = useMarkets(type);
  const { data: tickers } = useTickers(type);
  const navigate = useNavigate();
  const favorites = usePrefs((s) => s.favorites);
  const toggleFavorite = usePrefs((s) => s.toggleFavorite);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'fav' | string>('all');
  const quotes = useMemo(() => [...new Set((markets ?? []).map((m) => m.quote))], [markets]);
  const tmap = useMemo(() => new Map((tickers ?? []).map((t) => [t.symbol, t])), [tickers]);
  const rows = (markets ?? [])
    .filter((m) => m.status === 'TRADING')
    .filter((m) => (tab === 'fav' ? favorites.includes(m.symbol) : tab === 'all' ? true : m.quote === tab))
    .filter((m) => !q || m.symbol.includes(q.toUpperCase()));
  const go = (s: string) => {
    onSelect?.(s);
    navigate(type === 'FUTURES' ? `/futures/${s}` : `/trade/${s}`);
  };
  return (
    <div className={cx('mlist', compact && 'mlist--compact')}>
      <div className="mlist__search">
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search markets" />
      </div>
      <div className="mlist__tabs">
        {['fav', 'all', ...(type === 'SPOT' ? quotes : [])].map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'fav' ? <Icon name="star" size={12} /> : t === 'all' ? 'All' : t}
          </button>
        ))}
      </div>
      <div className="mlist__head">
        <span>Pair</span>
        <span>Price</span>
        <span>24h</span>
      </div>
      <div className="mlist__rows">
        {rows.map((m) => {
          const t: TickerDto | undefined = tmap.get(m.symbol);
          return (
            <div key={m.symbol} className={cx('mlist__row', active === m.symbol && 'active')} onClick={() => go(m.symbol)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(m.symbol)}>
              <button
                type="button"
                className={cx('mlist__star', favorites.includes(m.symbol) && 'on')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(m.symbol);
                }}
                aria-label={favorites.includes(m.symbol) ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Icon name="star" size={12} />
              </button>
              <span className="mlist__pair">
                <strong>{m.base}</strong>
                <span className="faint">{type === 'FUTURES' ? 'PERP' : `/${m.quote}`}</span>
              </span>
              <span className="num">{t ? fmtPrice(t.lastPrice, m) : '—'}</span>
              <ChangePct value={t?.priceChangePercent} />
            </div>
          );
        })}
        {markets && rows.length === 0 && <div className="gc-state">No markets</div>}
      </div>
    </div>
  );
}
