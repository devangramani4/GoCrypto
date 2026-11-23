import type { MarketDto, PriceLevel } from '@gocrypto/shared-types';
import { D, formatNumber } from '@gocrypto/trading-utils';
import { Skeleton, cx } from '@gocrypto/ui';
import { memo, useMemo, useState } from 'react';
import { fmtPrice } from '../../lib/format';
import { useOrderBook, useTicker } from '../../lib/hooks';
import { usePrefs } from '../../stores/session';
import { LivePrice } from '../common';

type View = 'both' | 'bids' | 'asks';

function group(levels: PriceLevel[], step: string | null, side: 'bid' | 'ask'): PriceLevel[] {
  if (!step) return levels;
  const g = D(step);
  const out = new Map<string, ReturnType<typeof D>>();
  for (const [p, q] of levels) {
    const b = side === 'bid' ? D(p).div(g).floor().mul(g) : D(p).div(g).ceil().mul(g);
    const k = b.toFixed();
    out.set(k, (out.get(k) ?? D(0)).plus(q));
  }
  return [...out.entries()].map(([p, q]) => [p, q.toFixed()] as PriceLevel);
}

const Row = memo(function Row({
  price,
  qty,
  total,
  depth,
  side,
  market,
  onClick,
}: {
  price: string;
  qty: string;
  total: string;
  depth: number;
  side: 'bid' | 'ask';
  market: MarketDto;
  onClick?: (p: string) => void;
}) {
  return (
    <button type="button" className={cx('ob__row', side)} onClick={() => onClick?.(price)}>
      <span className="ob__bar" style={{ width: `${Math.min(100, depth * 100)}%` }} />
      <span className={side === 'bid' ? 'up' : 'down'}>{fmtPrice(price, market)}</span>
      <span>{formatNumber(qty, market.qtyPrecision, { truncate: true })}</span>
      <span className="muted">{formatNumber(total, market.qtyPrecision > 2 ? 4 : 2, { truncate: true })}</span>
    </button>
  );
});

export function OrderBook({ market, onPriceClick, rows = 16 }: { market: MarketDto; onPriceClick?: (price: string) => void; rows?: number }) {
  const { data: book, loading } = useOrderBook(market.symbol);
  const { data: ticker } = useTicker(market.symbol);
  const [view, setView] = useState<View>('both');
  const stepPref = usePrefs((s) => s.orderBookStep[market.symbol]);
  const setStep = usePrefs((s) => s.setBookStep);
  const steps = useMemo(() => [1, 10, 100, 1000].map((m) => D(market.tickSize).mul(m).toFixed()), [market.tickSize]);
  const step = stepPref && steps.includes(stepPref) ? stepPref : steps[0]!;

  const { asks, bids, maxTotal, spread } = useMemo(() => {
    const isBase = step === steps[0];
    const a = group(book?.asks ?? [], isBase ? null : step, 'ask').slice(0, view === 'asks' ? rows * 2 : rows);
    const b = group(book?.bids ?? [], isBase ? null : step, 'bid').slice(0, view === 'bids' ? rows * 2 : rows);
    let acc = D(0);
    const asksCum = a.map(([p, q]) => {
      acc = acc.plus(q);
      return { p, q, total: acc };
    });
    acc = D(0);
    const bidsCum = b.map(([p, q]) => {
      acc = acc.plus(q);
      return { p, q, total: acc };
    });
    const max = Math.max(Number(asksCum[asksCum.length - 1]?.total ?? 0), Number(bidsCum[bidsCum.length - 1]?.total ?? 0), 1e-12);
    const bestAsk = a[0]?.[0];
    const bestBid = b[0]?.[0];
    const sp = bestAsk && bestBid ? { abs: D(bestAsk).minus(bestBid), pct: D(bestAsk).minus(bestBid).div(bestAsk).mul(100) } : null;
    return { asks: asksCum, bids: bidsCum, maxTotal: max, spread: sp };
  }, [book, step, steps, view, rows]);

  const last = ticker?.lastPrice ?? null;
  const dir = ticker ? (D(ticker.priceChange).gte(0) ? 'up' : 'down') : '';

  return (
    <div className="ob">
      <div className="ob__tools">
        <div className="ob__views" role="group" aria-label="Order book view">
          {(['both', 'bids', 'asks'] as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} aria-label={v} className={`ob__view ob__view--${v}`}>
              <i />
              <i />
            </button>
          ))}
        </div>
        <select className="ob__step" value={step} onChange={(e) => setStep(market.symbol, e.target.value)} aria-label="Price grouping">
          {steps.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="ob__head">
        <span>Price ({market.quote})</span>
        <span>Amount ({market.base})</span>
        <span>Total</span>
      </div>
      {loading ? (
        <div className="col" style={{ padding: 10, gap: 6 }}>
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} height={12} />
          ))}
        </div>
      ) : (
        <>
          {view !== 'bids' && (
            <div className="ob__side ob__side--asks">
              {[...asks].reverse().map((r) => (
                <Row key={r.p} price={r.p} qty={r.q} total={r.total.toFixed()} depth={Number(r.total) / maxTotal} side="ask" market={market} onClick={onPriceClick} />
              ))}
            </div>
          )}
          <div className="ob__mid">
            <LivePrice value={last} text={fmtPrice(last, market)} className={`ob__last ${dir}`} />
            {ticker?.markPrice && <span className="muted num" data-tip="Mark price">{fmtPrice(ticker.markPrice, market)}</span>}
            <span className="spacer" />
            {spread && (
              <span className="faint num" data-tip="Spread">
                {fmtPrice(spread.abs.toFixed(), market)} ({spread.pct.toFixed(3)}%)
              </span>
            )}
          </div>
          {view !== 'asks' && (
            <div className="ob__side">
              {bids.map((r) => (
                <Row key={r.p} price={r.p} qty={r.q} total={r.total.toFixed()} depth={Number(r.total) / maxTotal} side="bid" market={market} onClick={onPriceClick} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
