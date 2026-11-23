import type { OptionQuoteDto, OptionsChainRowDto, OrderSide } from '@gocrypto/shared-types';
import { D, FILTER_MESSAGES, checkPrice, checkQuantity, formatNumber, shortOptionInitialMargin } from '@gocrypto/trading-utils';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, KeyValue, Segmented, Skeleton, Switch, Tabs, cx, useToast } from '@gocrypto/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthCta, DecimalInput, InfoRow } from '../components/trading/controls';
import { OpenOrdersTable } from '../components/trading/OrdersPanel';
import { api, errorMessage } from '../lib/api';
import { fmtDateTime, fmtPrice, humanize, isPositive } from '../lib/format';
import { useAuthed } from '../lib/hooks';
import { OptionPositionsTable } from './PortfolioPage';

interface Selection {
  quote: OptionQuoteDto;
  type: 'CALL' | 'PUT';
  strike: string;
  side: OrderSide;
  price: string | null;
}

function expiryLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' }).toUpperCase();
}

function pct(iv: number | null | undefined): string {
  return iv === null || iv === undefined ? '—' : `${(iv * 100).toFixed(1)}%`;
}

export function OptionsPage() {
  const authed = useAuthed();
  const underlyings = useQuery({ queryKey: ['options', 'underlyings'], queryFn: () => api.options.underlyings(), staleTime: 300_000 });
  const [underlying, setUnderlying] = useState<string | null>(null);
  const u = underlying ?? underlyings.data?.[0] ?? null;
  const expiries = useQuery({ queryKey: ['options', 'expiries', u], queryFn: () => api.options.expiries(u!), enabled: Boolean(u), staleTime: 60_000 });
  const [expiry, setExpiry] = useState<number | null>(null);
  const exp = expiry && expiries.data?.some((e) => e.expiry === expiry) ? expiry : (expiries.data?.[0]?.expiry ?? null);
  const chain = useQuery({ queryKey: ['options', 'chain', u, exp], queryFn: () => api.options.chain(u!, exp!), enabled: Boolean(u && exp), refetchInterval: 4000 });
  const [greeks, setGreeks] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [bottom, setBottom] = useState<'positions' | 'orders'>('positions');
  useEffect(() => setSel(null), [u, exp]);

  // Keep the selected quote fresh as the chain refreshes.
  const live = useMemo(() => {
    if (!sel || !chain.data) return sel;
    const row = chain.data.rows.find((r) => r.strike === sel.strike);
    const q = sel.type === 'CALL' ? row?.call : row?.put;
    return q ? { ...sel, quote: q } : sel;
  }, [sel, chain.data]);

  const index = chain.data ? D(chain.data.indexPrice) : null;
  const pick = (q: OptionQuoteDto | null, type: 'CALL' | 'PUT', strike: string, side: OrderSide, price: string | null) => {
    if (q) setSel({ quote: q, type, strike, side, price });
  };

  const side = (row: OptionsChainRowDto, type: 'CALL' | 'PUT') => {
    const q = type === 'CALL' ? row.call : row.put;
    const itm = index ? (type === 'CALL' ? index.gt(row.strike) : index.lt(row.strike)) : false;
    const selected = Boolean(live && q && q.symbol === live.quote.symbol);
    const cls = (c: string) => cx(c, itm && 'itm', selected && 'sel');
    const cells = [
      greeks && <td key="g" className={cls('num faint')}>{q ? q.greeks.gamma.toFixed(5) : '—'}</td>,
      greeks && <td key="t" className={cls('num faint')}>{q ? q.greeks.theta.toFixed(2) : '—'}</td>,
      greeks && <td key="v" className={cls('num faint')}>{q ? q.greeks.vega.toFixed(2) : '—'}</td>,
      <td key="oi" className={cls('num muted')}>{q ? formatNumber(q.openInterest, 2, { trim: true }) : '—'}</td>,
      <td key="vol" className={cls('num muted')}>{q ? formatNumber(q.volume24h, 2, { trim: true }) : '—'}</td>,
      <td key="d" className={cls('num')}>{q ? q.greeks.delta.toFixed(3) : '—'}</td>,
      <td key="iv" className={cls('num muted')}>{q ? pct(q.markIv) : '—'}</td>,
      <td key="last" className={cls('num')}>{q?.last ? fmtPrice(q.last) : '—'}</td>,
      <td key="bid" className={cls('num chain__bid')}>
        <button type="button" disabled={!q?.bid} onClick={() => pick(q, type, row.strike, 'SELL', q?.bid ?? null)} title="Sell at bid">
          {q?.bid ? fmtPrice(q.bid) : '—'}
          {q?.bidIv != null && <small>{pct(q.bidIv)}</small>}
        </button>
      </td>,
      <td key="ask" className={cls('num chain__ask')}>
        <button type="button" disabled={!q?.ask} onClick={() => pick(q, type, row.strike, 'BUY', q?.ask ?? null)} title="Buy at ask">
          {q?.ask ? fmtPrice(q.ask) : '—'}
          {q?.askIv != null && <small>{pct(q.askIv)}</small>}
        </button>
      </td>,
    ].filter(Boolean);
    return type === 'CALL' ? cells : [...cells].reverse();
  };

  const heads = ['Gamma', 'Theta', 'Vega'].filter(() => greeks).concat(['OI', 'Volume', 'Delta', 'IV', 'Last', 'Bid', 'Ask']);

  return (
    <div className="page page--wide options">
      <div className="page__head">
        <div>
          <h1>Options</h1>
          <p className="muted">European-style, cash-settled in USDT at expiry (08:00 UTC). Premiums and Greeks are indicative; orders execute on the central order book.</p>
        </div>
      </div>
      <Card noPadding>
        <div className="options__bar">
          <Tabs value={u ?? ''} onChange={(v) => setUnderlying(v)} tabs={(underlyings.data ?? []).map((x) => ({ value: x, label: x }))} />
          <span className="spacer" />
          {chain.data && (
            <span className="options__index">
              <span className="faint">{u} index</span> <strong className="num">{fmtPrice(chain.data.indexPrice)}</strong>
            </span>
          )}
          <span className="row" style={{ gap: 8 }}>
            <span className="faint" style={{ fontSize: 12 }}>
              Greeks
            </span>
            <Switch checked={greeks} onChange={setGreeks} label="Show all Greeks" />
          </span>
        </div>
        <div className="options__expiries">
          {expiries.isLoading && <Skeleton width={300} height={26} />}
          {(expiries.data ?? []).map((e) => (
            <button key={e.expiry} type="button" className={cx('expiry-pill', e.expiry === exp && 'on')} onClick={() => setExpiry(e.expiry)}>
              {expiryLabel(e.expiry)} <span className="faint">{e.daysToExpiry}d</span>
            </button>
          ))}
          {expiries.data && expiries.data.length === 0 && <span className="faint">No active expiries</span>}
        </div>
      </Card>

      <div className="options__main">
        <Card noPadding className="options__chain">
          {chain.isLoading || underlyings.isLoading ? (
            <div style={{ padding: 16 }} className="col">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} height={22} />
              ))}
            </div>
          ) : !chain.data || chain.data.rows.length === 0 ? (
            <EmptyState icon="layers" title="No contracts listed" description="Option series are listed automatically by the options lifecycle worker." />
          ) : (
            <div className="chain-wrap">
              <table className="chain">
                <thead>
                  <tr className="chain__group">
                    <th colSpan={heads.length} className="up">
                      Calls
                    </th>
                    <th className="chain__strike-h">{expiryLabel(chain.data.expiry)}</th>
                    <th colSpan={heads.length} className="down">
                      Puts
                    </th>
                  </tr>
                  <tr>
                    {heads.map((h) => (
                      <th key={`c-${h}`}>{h}</th>
                    ))}
                    <th className="chain__strike-h">Strike</th>
                    {[...heads].reverse().map((h) => (
                      <th key={`p-${h}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chain.data.rows.map((row) => {
                    const atm = chain.data!.atmStrike === row.strike;
                    return (
                      <tr key={row.strike} className={cx(atm && 'atm')}>
                        {side(row, 'CALL')}
                        <td className="chain__strike num">
                          {formatNumber(row.strike, 0)}
                          {atm && <span className="chain__atm">ATM</span>}
                        </td>
                        {side(row, 'PUT')}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="options__ticket" title={live ? live.quote.symbol : 'Order ticket'}>
          {live ? <OptionTicket sel={live} indexPrice={chain.data?.indexPrice ?? '0'} onClose={() => setSel(null)} /> : <p className="muted">Select a bid to sell or an ask to buy a contract from the chain.</p>}
        </Card>
      </div>

      <Card
        noPadding
        title={
          <Tabs
            value={bottom}
            onChange={setBottom}
            tabs={[
              { value: 'positions', label: 'Positions' },
              { value: 'orders', label: 'Open orders' },
            ]}
          />
        }
      >
        {!authed ? <div className="gc-state">Log in to view your option positions.</div> : bottom === 'positions' ? <OptionPositionsTable /> : <OpenOrdersTable marketType="OPTIONS" />}
      </Card>
    </div>
  );
}

function OptionTicket({ sel, indexPrice, onClose }: { sel: Selection; indexPrice: string; onClose: () => void }) {
  const authed = useAuthed();
  const toast = useToast();
  const qc = useQueryClient();
  const market = useQuery({ queryKey: ['market', sel.quote.symbol], queryFn: () => api.markets.get(sel.quote.symbol), staleTime: 60_000 });
  const account = useQuery({ queryKey: ['options-account'], queryFn: () => api.options.account(), enabled: authed });
  const [side, setSide] = useState<OrderSide>(sel.side);
  const [type, setType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState(sel.price ?? sel.quote.markPrice);
  const [qty, setQty] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSide(sel.side);
    setPrice(sel.price ?? sel.quote.markPrice);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.quote.symbol, sel.side, sel.price]);

  const m = market.data;
  const refPrice = type === 'LIMIT' ? price : (side === 'BUY' ? sel.quote.ask : sel.quote.bid) ?? sel.quote.markPrice;
  const premium = isPositive(qty) && isPositive(refPrice) ? D(qty).mul(refPrice) : D(0);
  const fee = premium.mul(m?.takerFeeRate ?? '0.0003');
  const shortMargin =
    side === 'SELL' && isPositive(qty)
      ? shortOptionInitialMargin({ type: sel.type, indexPrice, strike: sel.strike, markPrice: sel.quote.markPrice, qty })
      : D(0);
  const available = account.data?.availableBalance ?? '0';

  const inFlight = useRef(false);
  const place = useMutation({
    onSettled: () => {
      inFlight.current = false;
    },
    mutationFn: () =>
      api.options.place({
        symbol: sel.quote.symbol,
        side,
        type,
        quantity: qty,
        ...(type === 'LIMIT' ? { price, timeInForce: 'GTC' } : {}),
        ...(reduceOnly ? { reduceOnly: true } : {}),
      }),
    onSuccess: ({ order: o }) => {
      if (o.status === 'REJECTED' || (o.status === 'EXPIRED' && !D(o.filledQuantity).gt(0))) toast.error(`Order ${o.status.toLowerCase()}`, o.rejectReason ? humanize(o.rejectReason) : undefined);
      else toast.success(o.status === 'FILLED' ? 'Order filled' : 'Order placed', `${o.side} ${o.quantity} ${o.symbol}`);
      setQty('');
      for (const k of ['orders', 'positions', 'options-account', 'balances', 'fills']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error('Order not placed', errorMessage(e)),
  });

  const submit = () => {
    setError(null);
    if (!m) return;
    if (type === 'LIMIT') {
      if (!isPositive(price)) return setError('Enter a price');
      const v = checkPrice(price, m);
      if (v) return setError(FILTER_MESSAGES[v]);
    }
    if (!isPositive(qty)) return setError('Enter a quantity');
    const qv = checkQuantity(qty, m, type === 'MARKET');
    if (qv) return setError(FILTER_MESSAGES[qv]);
    const need = side === 'BUY' ? premium.plus(fee) : shortMargin.minus(premium).plus(fee);
    if (!reduceOnly && need.gt(available)) return setError('Insufficient balance in your options account — transfer USDT from spot first');
    if (inFlight.current) return;
    inFlight.current = true;
    place.mutate();
  };

  const g = sel.quote.greeks;
  return (
    <div className="ticket ticket--plain">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 6 }}>
          <Badge tone={sel.type === 'CALL' ? 'brand' : 'warn'}>{sel.type}</Badge>
          <span className="muted num">
            K {formatNumber(sel.strike, 0)} · {m?.option ? fmtDateTime(m.option.expiry) : ''}
          </span>
        </span>
        <button type="button" className="link-btn faint" onClick={onClose}>
          Clear
        </button>
      </div>
      <KeyValue
        items={[
          ['Mark / IV', `${fmtPrice(sel.quote.markPrice)} · ${pct(sel.quote.markIv)}`],
          ['Bid / Ask', `${sel.quote.bid ? fmtPrice(sel.quote.bid) : '—'} / ${sel.quote.ask ? fmtPrice(sel.quote.ask) : '—'}`],
          ['Δ Γ Θ ν', `${g.delta.toFixed(3)} · ${g.gamma.toFixed(5)} · ${g.theta.toFixed(2)} · ${g.vega.toFixed(2)}`],
        ]}
      />
      <Segmented
        variant="buy-sell"
        value={side}
        onChange={setSide}
        options={[
          { value: 'BUY', label: 'Buy' },
          { value: 'SELL', label: 'Sell' },
        ]}
      />
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: 'LIMIT', label: 'Limit' },
          { value: 'MARKET', label: 'Market' },
        ]}
      />
      {type === 'LIMIT' && <DecimalInput label="Price" unit="USDT" value={price} onChange={setPrice} decimals={m?.pricePrecision ?? 2} />}
      <DecimalInput label="Quantity" unit={m?.base ?? ''} value={qty} onChange={setQty} decimals={m?.qtyPrecision ?? 2} />
      <Checkbox checked={reduceOnly} onChange={setReduceOnly}>
        Reduce-only
      </Checkbox>
      <div className="ticket__info">
        <InfoRow label="Available">{authed ? `${formatNumber(available, 2)} USDT` : '—'}</InfoRow>
        <InfoRow label={side === 'BUY' ? 'Premium (cost)' : 'Premium (received)'}>{premium.gt(0) ? `${formatNumber(premium, 2)} USDT` : '—'}</InfoRow>
        {side === 'SELL' && <InfoRow label="Initial margin (est.)" tip="Short options are margined: max(15% S − OTM, 10% S|K) + mark">{shortMargin.gt(0) ? `${formatNumber(shortMargin, 2)} USDT` : '—'}</InfoRow>}
        <InfoRow label="Est. fee">{fee.gt(0) ? `${formatNumber(fee, 4)} USDT` : '—'}</InfoRow>
        <InfoRow label="Max loss">{side === 'BUY' ? (premium.gt(0) ? `${formatNumber(premium.plus(fee), 2)} USDT` : '—') : <span className="down">Unlimited{sel.type === 'PUT' ? ' (to strike)' : ''}</span>}</InfoRow>
      </div>
      {side === 'SELL' && !reduceOnly && <Alert tone="warn">Selling options carries substantial risk; losses can exceed the premium received.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {authed ? (
        <Button variant={side === 'BUY' ? 'buy' : 'sell'} size="lg" block loading={place.isPending} onClick={submit} disabled={!m}>
          {side === 'BUY' ? 'Buy' : 'Sell'} {sel.type === 'CALL' ? 'call' : 'put'}
        </Button>
      ) : (
        <AuthCta />
      )}
    </div>
  );
}
