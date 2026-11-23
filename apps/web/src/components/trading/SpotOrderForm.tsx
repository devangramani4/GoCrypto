import { ApiError } from '@gocrypto/api-client';
import type { MarketDto, OrderDto, OrderSide } from '@gocrypto/shared-types';
import {
  D,
  FILTER_MESSAGES,
  ROUND_DOWN,
  checkNotional,
  checkPrice,
  checkQuantity,
  floorToStep,
  formatNumber,
} from '@gocrypto/trading-utils';
import { Alert, Button, Checkbox, KeyValue, Modal, Segmented, Tabs, useToast } from '@gocrypto/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { fmtPrice, fmtQty, formatPercent, humanize, isPositive } from '../../lib/format';
import { useAuthed, useAvailable, useTicker } from '../../lib/hooks';
import { usePrefs, useSession } from '../../stores/session';
import { useTicket } from '../../stores/ticket';
import { AuthCta, DecimalInput, InfoRow, PercentSlider } from './controls';

export type SpotKind = 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'STOP_MARKET' | 'OCO';
type Tif = 'GTC' | 'IOC' | 'FOK';

const KINDS: { value: SpotKind; label: string }[] = [
  { value: 'LIMIT', label: 'Limit' },
  { value: 'MARKET', label: 'Market' },
  { value: 'STOP_LIMIT', label: 'Stop Limit' },
  { value: 'STOP_MARKET', label: 'Stop Market' },
  { value: 'OCO', label: 'OCO' },
];

const TOTAL_DECIMALS = 8;

type Errors = Partial<Record<'price' | 'stopPrice' | 'stopLimit' | 'qty' | 'total' | 'form', string>>;

/**
 * Spot order ticket. Everything shown here is an estimate for the user's convenience — the server
 * re-validates filters, recomputes balances/fees and decides the execution.
 */
export function SpotOrderForm({ market }: { market: MarketDto }) {
  const authed = useAuthed();
  const user = useSession((s) => s.user);
  const confirmOrders = usePrefs((s) => s.confirmOrders);
  const setConfirmOrders = usePrefs((s) => s.setConfirmOrders);
  const toast = useToast();
  const qc = useQueryClient();
  const { data: ticker } = useTicker(market.symbol);

  const [side, setSide] = useState<OrderSide>('BUY');
  const [kind, setKind] = useState<SpotKind>('LIMIT');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [stopLimit, setStopLimit] = useState('');
  const [qty, setQty] = useState('');
  const [total, setTotal] = useState('');
  const [lastEdited, setLastEdited] = useState<'qty' | 'total'>('qty');
  const [pct, setPct] = useState(0);
  const [postOnly, setPostOnly] = useState(false);
  const [tif, setTif] = useState<Tif>('GTC');
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);

  const baseAvail = useAvailable('SPOT', market.base);
  const quoteAvail = useAvailable('SPOT', market.quote);
  const available = side === 'BUY' ? quoteAvail : baseAvail;
  const needsPrice = kind === 'LIMIT' || kind === 'STOP_LIMIT' || kind === 'OCO';
  const needsStop = kind === 'STOP_LIMIT' || kind === 'STOP_MARKET' || kind === 'OCO';
  const marketBuyByQuote = kind === 'MARKET' && side === 'BUY' && lastEdited === 'total';

  // Reset the ticket when switching markets; prefill the price once per market.
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    setPrice('');
    setStopPrice('');
    setStopLimit('');
    setQty('');
    setTotal('');
    setPct(0);
    setErrors({});
    prefilled.current = null;
  }, [market.symbol]);
  useEffect(() => {
    if (ticker && prefilled.current !== market.symbol) {
      prefilled.current = market.symbol;
      setPrice(D(ticker.lastPrice).toFixed(market.pricePrecision));
    }
  }, [ticker, market.symbol, market.pricePrecision]);

  /** Price used to convert between amount and total. */
  const refPrice = useMemo(() => {
    if (kind === 'MARKET') return (side === 'BUY' ? ticker?.bestAsk : ticker?.bestBid) ?? ticker?.lastPrice ?? '';
    if (kind === 'STOP_MARKET') return stopPrice || ticker?.lastPrice || '';
    return price;
  }, [kind, side, ticker, stopPrice, price]);

  const recompute = (nextQty: string, nextTotal: string, edited: 'qty' | 'total', ref: string) => {
    if (edited === 'qty') {
      setTotal(
        isPositive(nextQty) && isPositive(ref)
          ? D(nextQty).mul(ref).toDecimalPlaces(TOTAL_DECIMALS, ROUND_DOWN).toFixed()
          : '',
      );
    } else {
      setQty(
        isPositive(nextTotal) && isPositive(ref) ? floorToStep(D(nextTotal).div(ref), market.stepSize).toFixed() : '',
      );
    }
  };

  // Order-book / trade clicks fill the price.
  const pickSeq = useTicket((s) => s.seq);
  useEffect(() => {
    const { price: picked } = useTicket.getState();
    if (!pickSeq || !picked) return;
    if (kind === 'MARKET' || kind === 'STOP_MARKET') setKind('LIMIT');
    setPrice(picked);
    recompute(qty, total, lastEdited, picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSeq]);

  const onPrice = (v: string) => {
    setPrice(v);
    setErrors((e) => ({ ...e, price: undefined, form: undefined }));
    if (kind !== 'MARKET' && kind !== 'STOP_MARKET') recompute(qty, total, lastEdited, v);
  };
  const onStop = (v: string) => {
    setStopPrice(v);
    setErrors((e) => ({ ...e, stopPrice: undefined, form: undefined }));
    if (kind === 'STOP_MARKET') recompute(qty, total, lastEdited, v);
  };
  const onQty = (v: string) => {
    setQty(v);
    setLastEdited('qty');
    setPct(0);
    setErrors((e) => ({ ...e, qty: undefined, total: undefined, form: undefined }));
    recompute(v, total, 'qty', refPrice);
  };
  const onTotal = (v: string) => {
    setTotal(v);
    setLastEdited('total');
    setPct(0);
    setErrors((e) => ({ ...e, qty: undefined, total: undefined, form: undefined }));
    recompute(qty, v, 'total', refPrice);
  };
  const onPct = (p: number) => {
    setPct(p);
    setErrors({});
    const avail = D(available);
    if (side === 'BUY') {
      const budget = avail.mul(p).div(100).toDecimalPlaces(TOTAL_DECIMALS, ROUND_DOWN);
      if (kind === 'MARKET') {
        setLastEdited('total');
        setTotal(budget.gt(0) ? budget.toFixed() : '');
        recompute(qty, budget.toFixed(), 'total', refPrice);
        return;
      }
      if (!isPositive(refPrice)) return;
      const q = floorToStep(budget.div(refPrice), market.stepSize);
      setLastEdited('qty');
      setQty(q.gt(0) ? q.toFixed() : '');
      recompute(q.toFixed(), total, 'qty', refPrice);
    } else {
      const q = floorToStep(avail.mul(p).div(100), market.stepSize);
      setLastEdited('qty');
      setQty(q.gt(0) ? q.toFixed() : '');
      recompute(q.toFixed(), total, 'qty', refPrice);
    }
  };

  const validate = (): Errors => {
    const e: Errors = {};
    const f = {
      tickSize: market.tickSize,
      stepSize: market.stepSize,
      minQty: market.minQty,
      maxQty: market.maxQty,
      minNotional: market.minNotional,
    };
    if (needsPrice) {
      if (!isPositive(price)) e.price = 'Enter a price';
      else {
        const v = checkPrice(price, f);
        if (v) e.price = FILTER_MESSAGES[v];
      }
    }
    if (needsStop) {
      if (!isPositive(stopPrice)) e.stopPrice = 'Enter a trigger price';
      else {
        const v = checkPrice(stopPrice, f);
        if (v) e.stopPrice = FILTER_MESSAGES[v];
      }
    }
    if (kind === 'OCO' && stopLimit) {
      const v = checkPrice(stopLimit, f);
      if (v) e.stopLimit = FILTER_MESSAGES[v];
    }
    if (marketBuyByQuote) {
      if (!isPositive(total)) e.total = 'Enter an amount';
      else if (D(total).lt(market.minNotional)) e.total = FILTER_MESSAGES.NOTIONAL_BELOW_MIN;
    } else if (!isPositive(qty)) {
      e.qty = 'Enter an amount';
    } else {
      const v = checkQuantity(qty, f, kind === 'MARKET');
      if (v) e.qty = FILTER_MESSAGES[v];
      else if (isPositive(refPrice)) {
        const n = checkNotional(refPrice, qty, f);
        if (n) e.qty = FILTER_MESSAGES[n];
      }
    }
    if (Object.keys(e).length) return e;
    if (side === 'BUY') {
      const need = marketBuyByQuote ? D(total) : D(qty).mul(isPositive(refPrice) ? refPrice : 0);
      if (need.gt(quoteAvail)) e.form = `Insufficient ${market.quote} balance`;
    } else if (D(qty).gt(baseAvail)) {
      e.form = `Insufficient ${market.base} balance`;
    }
    if (kind === 'OCO' && !e.form && ticker) {
      const last = D(ticker.lastPrice);
      if (side === 'SELL' && !(D(price).gt(last) && D(stopPrice).lt(last)))
        e.form = 'Sell OCO: the limit price must be above and the trigger price below the last price';
      if (side === 'BUY' && !(D(price).lt(last) && D(stopPrice).gt(last)))
        e.form = 'Buy OCO: the limit price must be below and the trigger price above the last price';
    }
    return e;
  };

  const body = (): Record<string, unknown> => {
    const b = { symbol: market.symbol, side };
    switch (kind) {
      case 'LIMIT':
        return { ...b, type: 'LIMIT', price, quantity: qty, ...(postOnly ? { postOnly: true } : { timeInForce: tif }) };
      case 'MARKET':
        return marketBuyByQuote
          ? { ...b, type: 'MARKET', quoteQuantity: total }
          : { ...b, type: 'MARKET', quantity: qty };
      case 'STOP_LIMIT':
        return { ...b, type: 'STOP_LIMIT', stopPrice, price, quantity: qty, timeInForce: tif };
      case 'STOP_MARKET':
        return { ...b, type: 'STOP_MARKET', stopPrice, quantity: qty };
      case 'OCO':
        return { ...b, quantity: qty, price, stopPrice, ...(stopLimit ? { stopLimitPrice: stopLimit } : {}) };
    }
  };

  // Synchronous re-entrancy guard: a burst of clicks can arrive before React re-renders the disabled button.
  const inFlight = useRef(false);
  const place = useMutation({
    onSettled: () => {
      inFlight.current = false;
    },
    mutationFn: async (): Promise<OrderDto[]> => {
      if (kind === 'OCO') return (await api.spot.placeOco(body())).orders.map((r) => r.order);
      return [(await api.spot.place(body())).order];
    },
    onSuccess: (orders) => {
      setConfirming(false);
      const o = orders[0]!;
      if (o.status === 'REJECTED' || (o.status === 'EXPIRED' && !D(o.filledQuantity).gt(0))) {
        toast.error(`Order ${o.status.toLowerCase()}`, o.rejectReason ? humanize(o.rejectReason) : undefined);
      } else if (o.status === 'FILLED') {
        toast.success(
          'Order filled',
          `${o.side === 'BUY' ? 'Bought' : 'Sold'} ${fmtQty(o.filledQuantity, market)} ${market.base} @ ${fmtPrice(o.avgPrice, market)}`,
        );
      } else {
        toast.success(
          kind === 'OCO' ? 'OCO order placed' : 'Order placed',
          `${humanize(o.type)} ${o.side.toLowerCase()} ${o.quantity ? `${fmtQty(o.quantity, market)} ${market.base}` : ''}`,
        );
      }
      setQty('');
      setTotal('');
      setPct(0);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['balances'] });
      void qc.invalidateQueries({ queryKey: ['fills'] });
    },
    onError: (err) => {
      setConfirming(false);
      if (err instanceof ApiError) {
        const fe = err.fieldErrors();
        const mapped: Errors = {
          price: fe.price,
          stopPrice: fe.stopPrice,
          stopLimit: fe.stopLimitPrice,
          qty: fe.quantity,
          total: fe.quoteQuantity,
        };
        if (Object.values(mapped).some(Boolean)) {
          setErrors(mapped);
          return;
        }
      }
      toast.error('Order not placed', errorMessage(err));
    },
  });

  const send = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    place.mutate();
  };

  const submit = () => {
    if (inFlight.current) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    if (confirmOrders) setConfirming(true);
    else send();
  };

  const feeRate = kind === 'LIMIT' && postOnly ? market.makerFeeRate : market.takerFeeRate;
  const notional = marketBuyByQuote
    ? total
    : isPositive(qty) && isPositive(refPrice)
      ? D(qty).mul(refPrice).toFixed()
      : '';
  const maxText =
    side === 'BUY'
      ? isPositive(refPrice)
        ? `${fmtQty(floorToStep(D(quoteAvail).div(refPrice), market.stepSize).toFixed(), market)} ${market.base}`
        : '—'
      : isPositive(refPrice)
        ? `${formatNumber(D(baseAvail).mul(refPrice), 2)} ${market.quote}`
        : '—';
  const blocked =
    market.status !== 'TRADING'
      ? 'Trading on this market is currently paused.'
      : user && !user.tradingEnabled
        ? 'Trading is disabled for your account. Contact support.'
        : null;

  return (
    <div className="ticket">
      <Segmented
        variant="buy-sell"
        className="ticket__side"
        value={side}
        onChange={(s) => {
          setSide(s);
          setPct(0);
          setErrors({});
        }}
        options={[
          { value: 'BUY', label: 'Buy' },
          { value: 'SELL', label: 'Sell' },
        ]}
      />
      <Tabs
        variant="pills"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setErrors({});
          if (k === 'MARKET') setLastEdited(side === 'BUY' ? 'total' : 'qty');
        }}
        tabs={KINDS}
      />

      <div className="ticket__fields">
        {needsStop && (
          <DecimalInput
            label={kind === 'OCO' ? 'Stop trigger' : 'Trigger'}
            unit={market.quote}
            value={stopPrice}
            onChange={onStop}
            decimals={market.pricePrecision}
            error={errors.stopPrice}
            name="stopPrice"
          />
        )}
        {kind === 'OCO' && (
          <DecimalInput
            label="Stop limit"
            unit={market.quote}
            value={stopLimit}
            onChange={setStopLimit}
            decimals={market.pricePrecision}
            error={errors.stopLimit}
            placeholder="Market"
            name="stopLimit"
          />
        )}
        {needsPrice ? (
          <DecimalInput
            label={kind === 'OCO' ? 'Limit price' : 'Price'}
            unit={market.quote}
            value={price}
            onChange={onPrice}
            decimals={market.pricePrecision}
            error={errors.price}
            name="price"
          />
        ) : (
          kind === 'MARKET' && (
            <div className="ticket__market-price">
              <span className="faint">Price</span>
              <span>Best market price</span>
            </div>
          )
        )}
        <DecimalInput
          label="Amount"
          unit={market.base}
          value={qty}
          onChange={onQty}
          decimals={market.qtyPrecision}
          error={errors.qty}
          name="quantity"
        />
        <PercentSlider value={pct} onChange={onPct} disabled={!authed} tone={side === 'BUY' ? 'up' : 'down'} />
        <DecimalInput
          label={kind === 'MARKET' && !(side === 'BUY' && lastEdited === 'total') ? 'Total ≈' : 'Total'}
          unit={market.quote}
          value={total}
          onChange={onTotal}
          decimals={TOTAL_DECIMALS}
          error={errors.total}
          name="total"
        />

        {(kind === 'LIMIT' || kind === 'STOP_LIMIT') && (
          <div className="ticket__opts">
            {kind === 'LIMIT' && (
              <Checkbox checked={postOnly} onChange={setPostOnly}>
                <span data-tip="Only adds liquidity: rejected if it would match immediately">Post-only</span>
              </Checkbox>
            )}
            <label className="ticket__tif">
              <span className="faint">TIF</span>
              <select
                value={tif}
                onChange={(e) => setTif(e.target.value as Tif)}
                disabled={postOnly && kind === 'LIMIT'}
                aria-label="Time in force"
              >
                <option value="GTC">GTC</option>
                <option value="IOC">IOC</option>
                <option value="FOK">FOK</option>
              </select>
            </label>
          </div>
        )}
        {needsStop && ticker && isPositive(stopPrice) && (
          <p className="ticket__hint">
            Triggers when the last price {D(stopPrice).gte(ticker.lastPrice) ? 'rises to' : 'falls to'}{' '}
            {fmtPrice(stopPrice, market)} {market.quote}
            {kind === 'OCO' ? '; the other leg is cancelled automatically.' : '.'}
          </p>
        )}
      </div>

      <div className="ticket__info">
        <InfoRow label="Available">
          {authed
            ? `${formatNumber(available, side === 'BUY' ? 2 : market.qtyPrecision, { truncate: true })} ${side === 'BUY' ? market.quote : market.base}`
            : '—'}
          {authed && (
            <Link
              className="ticket__deposit"
              to={`/wallet/deposit?asset=${side === 'BUY' ? market.quote : market.base}`}
              aria-label="Deposit"
            >
              +
            </Link>
          )}
        </InfoRow>
        <InfoRow label={side === 'BUY' ? 'Max buy' : 'Max sell'}>{authed ? maxText : '—'}</InfoRow>
        <InfoRow
          label="Est. fee"
          tip={`Maker ${formatPercent(market.makerFeeRate, 3, false)} · Taker ${formatPercent(market.takerFeeRate, 3, false)} (VIP discounts applied at execution)`}
        >
          {notional ? `${formatNumber(D(notional).mul(feeRate), 4)} ${market.quote}` : formatPercent(feeRate, 3, false)}
        </InfoRow>
      </div>

      {blocked && authed && <Alert tone="warn">{blocked}</Alert>}
      {errors.form && <Alert tone="error">{errors.form}</Alert>}

      {authed ? (
        <Button
          variant={side === 'BUY' ? 'buy' : 'sell'}
          size="lg"
          block
          loading={place.isPending}
          disabled={Boolean(blocked)}
          onClick={submit}
        >
          {side === 'BUY' ? 'Buy' : 'Sell'} {market.base}
        </Button>
      ) : (
        <AuthCta />
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Confirm ${side === 'BUY' ? 'buy' : 'sell'} order`}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant={side === 'BUY' ? 'buy' : 'sell'}
              loading={place.isPending}
              onClick={() => {
                if (dontAsk) setConfirmOrders(false);
                send();
              }}
            >
              Confirm {side === 'BUY' ? 'buy' : 'sell'}
            </Button>
          </>
        }
      >
        <KeyValue
          items={[
            ['Market', `${market.base}/${market.quote} · Spot`],
            [
              'Side',
              <span key="s" className={side === 'BUY' ? 'up' : 'down'}>
                {side}
              </span>,
            ],
            ['Type', KINDS.find((k) => k.value === kind)!.label],
            ...(needsStop
              ? ([['Trigger price', `${fmtPrice(stopPrice, market)} ${market.quote}`]] as [string, string][])
              : []),
            ...(needsPrice
              ? ([[kind === 'OCO' ? 'Limit price' : 'Price', `${fmtPrice(price, market)} ${market.quote}`]] as [
                  string,
                  string,
                ][])
              : []),
            ...(kind === 'OCO'
              ? ([['Stop limit', stopLimit ? `${fmtPrice(stopLimit, market)} ${market.quote}` : 'Market']] as [
                  string,
                  string,
                ][])
              : []),
            [
              'Amount',
              marketBuyByQuote ? `≈ ${fmtQty(qty, market)} ${market.base}` : `${fmtQty(qty, market)} ${market.base}`,
            ],
            [
              'Total',
              `${kind === 'MARKET' && !marketBuyByQuote ? '≈ ' : ''}${formatNumber(notional || '0', 2)} ${market.quote}`,
            ],
            ...(kind === 'LIMIT' ? ([['Options', postOnly ? 'Post-only' : tif]] as [string, string][]) : []),
          ]}
        />
        <div style={{ marginTop: 14 }}>
          <Checkbox checked={dontAsk} onChange={setDontAsk}>
            Don&apos;t show this confirmation again
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
}
