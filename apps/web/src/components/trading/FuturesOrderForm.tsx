import { ApiError } from '@gocrypto/api-client';
import type { FuturesSettingsDto, MarginMode, MarketDto, OrderSide, OrderType } from '@gocrypto/shared-types';
import {
  D,
  FILTER_MESSAGES,
  checkNotional,
  checkPrice,
  checkQuantity,
  floorToStep,
  formatNumber,
  liquidationPrice,
  maxLeverageForNotional,
} from '@gocrypto/trading-utils';
import { Alert, Button, Checkbox, KeyValue, Modal, Tabs, cx, useToast } from '@gocrypto/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { fmtPrice, fmtQty, humanize, isPositive } from '../../lib/format';
import { useAuthed, useFuturesAccount, useTicker } from '../../lib/hooks';
import { usePrefs, useSession } from '../../stores/session';
import { useTicket } from '../../stores/ticket';
import { AuthCta, DecimalInput, InfoRow, PercentSlider } from './controls';

type Tab = 'LIMIT' | 'MARKET' | 'CONDITIONAL';
type CondType = 'STOP_MARKET' | 'STOP_LIMIT' | 'TAKE_PROFIT_MARKET' | 'TAKE_PROFIT_LIMIT';
type Tif = 'GTC' | 'IOC' | 'FOK';
type Errors = Partial<Record<'price' | 'stopPrice' | 'qty' | 'tp' | 'sl' | 'form', string>>;

const COND_LABEL: Record<CondType, string> = {
  STOP_MARKET: 'Stop Market',
  STOP_LIMIT: 'Stop Limit',
  TAKE_PROFIT_MARKET: 'Take Profit Market',
  TAKE_PROFIT_LIMIT: 'Take Profit Limit',
};

export function useFuturesSettings(market: MarketDto) {
  const authed = useAuthed();
  const q = useQuery({
    queryKey: ['futures-settings', market.symbol],
    queryFn: () => api.futures.settings(market.symbol),
    enabled: authed,
  });
  const fallback: FuturesSettingsDto = {
    symbol: market.symbol,
    leverage: market.futures?.defaultLeverage ?? 10,
    marginMode: 'CROSS',
    maxLeverage: market.futures?.maxLeverage ?? 20,
  };
  return { settings: q.data ?? fallback, loaded: Boolean(q.data) };
}

export function FuturesOrderForm({ market }: { market: MarketDto }) {
  const authed = useAuthed();
  const user = useSession((s) => s.user);
  const confirmOrders = usePrefs((s) => s.confirmOrders);
  const setConfirmOrders = usePrefs((s) => s.setConfirmOrders);
  const toast = useToast();
  const qc = useQueryClient();
  const { data: ticker } = useTicker(market.symbol);
  const { data: account } = useFuturesAccount();
  const { settings } = useFuturesSettings(market);
  const settle = market.futures?.settleAsset ?? market.quote;
  const tiers = market.futures?.riskTiers ?? [];

  const [tab, setTab] = useState<Tab>('LIMIT');
  const [cond, setCond] = useState<CondType>('STOP_MARKET');
  const [workingType, setWorkingType] = useState<'MARK_PRICE' | 'LAST_PRICE'>('MARK_PRICE');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [qty, setQty] = useState('');
  const [pct, setPct] = useState(0);
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [tif, setTif] = useState<Tif>('GTC');
  const [errors, setErrors] = useState<Errors>({});
  const [confirmSide, setConfirmSide] = useState<OrderSide | null>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const [levOpen, setLevOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  const type: OrderType = tab === 'LIMIT' ? 'LIMIT' : tab === 'MARKET' ? 'MARKET' : cond;
  const needsPrice = type === 'LIMIT' || type === 'STOP_LIMIT' || type === 'TAKE_PROFIT_LIMIT';
  const needsStop = tab === 'CONDITIONAL';
  const available = account?.availableBalance ?? '0';
  const leverage = settings.leverage;

  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    setPrice('');
    setStopPrice('');
    setQty('');
    setPct(0);
    setTp('');
    setSl('');
    setErrors({});
    prefilled.current = null;
  }, [market.symbol]);
  useEffect(() => {
    if (ticker && prefilled.current !== market.symbol) {
      prefilled.current = market.symbol;
      setPrice(D(ticker.lastPrice).toFixed(market.pricePrecision));
    }
  }, [ticker, market.symbol, market.pricePrecision]);

  const pickSeq = useTicket((s) => s.seq);
  useEffect(() => {
    const picked = useTicket.getState().price;
    if (!pickSeq || !picked) return;
    if (tab === 'MARKET') setTab('LIMIT');
    setPrice(picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSeq]);

  const refPrice = useMemo(() => {
    if (needsPrice && isPositive(price)) return price;
    if (needsStop && isPositive(stopPrice)) return stopPrice;
    return ticker?.markPrice ?? ticker?.lastPrice ?? '';
  }, [needsPrice, needsStop, price, stopPrice, ticker]);

  const maxQty = useMemo(() => {
    if (!isPositive(refPrice) || !isPositive(available)) return D(0);
    // available × leverage / price, leaving room for the taker fee on the notional.
    const gross = D(available)
      .mul(leverage)
      .div(D(refPrice).mul(D(1).plus(D(market.takerFeeRate).mul(leverage))));
    return floorToStep(gross, market.stepSize);
  }, [refPrice, available, leverage, market.stepSize, market.takerFeeRate]);

  const notional = isPositive(qty) && isPositive(refPrice) ? D(qty).mul(refPrice) : D(0);
  const cost = notional.gt(0) ? notional.div(leverage).plus(notional.mul(market.takerFeeRate)) : D(0);

  const estLiq = (side: 'LONG' | 'SHORT') => {
    if (!notional.gt(0) || !tiers.length) return null;
    const margin = settings.marginMode === 'ISOLATED' ? notional.div(leverage) : D(available);
    return liquidationPrice({ side, qty, entryPrice: refPrice, margin, tiers });
  };

  const onPct = (p: number) => {
    setPct(p);
    setErrors({});
    const q = floorToStep(maxQty.mul(p).div(100), market.stepSize);
    setQty(q.gt(0) ? q.toFixed() : '');
  };

  const validate = (side: OrderSide): Errors => {
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
      else if (checkPrice(price, f)) e.price = FILTER_MESSAGES[checkPrice(price, f)!];
    }
    if (needsStop) {
      if (!isPositive(stopPrice)) e.stopPrice = 'Enter a trigger price';
      else if (checkPrice(stopPrice, f)) e.stopPrice = FILTER_MESSAGES[checkPrice(stopPrice, f)!];
    }
    if (!isPositive(qty)) e.qty = 'Enter a size';
    else {
      const v =
        checkQuantity(qty, f, type === 'MARKET') ?? (isPositive(refPrice) ? checkNotional(refPrice, qty, f) : null);
      if (v) e.qty = FILTER_MESSAGES[v];
    }
    if (tpsl && !reduceOnly && isPositive(refPrice)) {
      const long = side === 'BUY';
      if (tp && (long ? D(tp).lte(refPrice) : D(tp).gte(refPrice)))
        e.tp = `Take profit must be ${long ? 'above' : 'below'} the entry price`;
      if (sl && (long ? D(sl).gte(refPrice) : D(sl).lte(refPrice)))
        e.sl = `Stop loss must be ${long ? 'below' : 'above'} the entry price`;
      if (!tp && !sl) e.tp = 'Enter a take-profit and/or stop-loss price';
    }
    if (!Object.keys(e).length && !reduceOnly && cost.gt(available))
      e.form = `Insufficient ${settle} margin — transfer funds to your futures account`;
    if (
      !Object.keys(e).length &&
      !reduceOnly &&
      notional.gt(0) &&
      tiers.length &&
      leverage > maxLeverageForNotional(tiers, notional)
    ) {
      e.form = `Position too large for ${leverage}x — reduce leverage to ${maxLeverageForNotional(tiers, notional)}x or the size`;
    }
    return e;
  };

  const body = (side: OrderSide): Record<string, unknown> => {
    const b: Record<string, unknown> = { symbol: market.symbol, side, type, quantity: qty };
    if (needsPrice) b.price = price;
    if (needsStop) {
      b.stopPrice = stopPrice;
      b.workingType = workingType;
    }
    if (type === 'LIMIT') {
      if (postOnly) b.postOnly = true;
      else b.timeInForce = tif;
    } else if (needsPrice) b.timeInForce = tif;
    if (reduceOnly) b.reduceOnly = true;
    if (tpsl && !reduceOnly) {
      if (tp) b.takeProfitPrice = tp;
      if (sl) b.stopLossPrice = sl;
    }
    return b;
  };

  const inFlight = useRef(false);
  const place = useMutation({
    onSettled: () => {
      inFlight.current = false;
    },
    mutationFn: (side: OrderSide) => api.futures.place(body(side)),
    onSuccess: ({ order: o }) => {
      setConfirmSide(null);
      if (o.status === 'REJECTED' || (o.status === 'EXPIRED' && !D(o.filledQuantity).gt(0))) {
        toast.error(`Order ${o.status.toLowerCase()}`, o.rejectReason ? humanize(o.rejectReason) : undefined);
      } else if (o.status === 'FILLED') {
        toast.success(
          `${o.side === 'BUY' ? 'Long' : 'Short'} filled`,
          `${fmtQty(o.filledQuantity, market)} ${market.base} @ ${fmtPrice(o.avgPrice, market)}`,
        );
      } else {
        toast.success(
          'Order placed',
          `${humanize(o.type)} ${o.side === 'BUY' ? 'buy/long' : 'sell/short'} ${fmtQty(o.quantity, market)} ${market.base}`,
        );
      }
      setQty('');
      setPct(0);
      for (const k of ['orders', 'positions', 'futures-account', 'balances', 'fills'])
        void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (err) => {
      setConfirmSide(null);
      if (err instanceof ApiError) {
        const fe = err.fieldErrors();
        const mapped: Errors = {
          price: fe.price,
          stopPrice: fe.stopPrice,
          qty: fe.quantity,
          tp: fe.takeProfitPrice,
          sl: fe.stopLossPrice,
        };
        if (Object.values(mapped).some(Boolean)) return setErrors(mapped);
      }
      toast.error('Order not placed', errorMessage(err));
    },
  });

  const send = (side: OrderSide) => {
    if (inFlight.current) return;
    inFlight.current = true;
    place.mutate(side);
  };

  const submit = (side: OrderSide) => {
    if (inFlight.current) return;
    const e = validate(side);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (confirmOrders) setConfirmSide(side);
    else send(side);
  };

  const blocked =
    market.status !== 'TRADING'
      ? 'Trading on this market is currently paused.'
      : user && !user.tradingEnabled
        ? 'Trading is disabled for your account.'
        : null;
  const liqLong = estLiq('LONG');
  const liqShort = estLiq('SHORT');

  return (
    <div className="ticket">
      <div className="ticket__lev">
        <button
          type="button"
          className="ticket__chip"
          onClick={() => (authed ? setModeOpen(true) : undefined)}
          disabled={!authed}
        >
          {settings.marginMode === 'CROSS' ? 'Cross' : 'Isolated'}
        </button>
        <button
          type="button"
          className="ticket__chip ticket__chip--lev"
          onClick={() => (authed ? setLevOpen(true) : undefined)}
          disabled={!authed}
        >
          {leverage}x
        </button>
      </div>
      <Tabs
        variant="pills"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setErrors({});
        }}
        tabs={[
          { value: 'LIMIT', label: 'Limit' },
          { value: 'MARKET', label: 'Market' },
          { value: 'CONDITIONAL', label: 'Conditional' },
        ]}
      />
      <div className="ticket__fields">
        {needsStop && (
          <>
            <div className="ticket__cond">
              <select
                value={cond}
                onChange={(e) => setCond(e.target.value as CondType)}
                aria-label="Conditional order type"
              >
                {(Object.keys(COND_LABEL) as CondType[]).map((c) => (
                  <option key={c} value={c}>
                    {COND_LABEL[c]}
                  </option>
                ))}
              </select>
              <select
                value={workingType}
                onChange={(e) => setWorkingType(e.target.value as 'MARK_PRICE' | 'LAST_PRICE')}
                aria-label="Trigger price source"
              >
                <option value="MARK_PRICE">Mark</option>
                <option value="LAST_PRICE">Last</option>
              </select>
            </div>
            <DecimalInput
              label="Trigger"
              unit={market.quote}
              value={stopPrice}
              onChange={(v) => (setStopPrice(v), setErrors({}))}
              decimals={market.pricePrecision}
              error={errors.stopPrice}
              name="stopPrice"
            />
          </>
        )}
        {needsPrice ? (
          <DecimalInput
            label="Price"
            unit={market.quote}
            value={price}
            onChange={(v) => (setPrice(v), setErrors({}))}
            decimals={market.pricePrecision}
            error={errors.price}
            name="price"
          />
        ) : (
          !needsStop && (
            <div className="ticket__market-price">
              <span className="faint">Price</span>
              <span>Best market price</span>
            </div>
          )
        )}
        <DecimalInput
          label="Size"
          unit={market.base}
          value={qty}
          onChange={(v) => {
            setQty(v);
            setPct(0);
            setErrors({});
          }}
          decimals={market.qtyPrecision}
          error={errors.qty}
          name="quantity"
        />
        <PercentSlider value={pct} onChange={onPct} disabled={!authed} />
        <div className="ticket__opts ticket__opts--wrap">
          <Checkbox checked={tpsl} onChange={(v) => (setTpsl(v), v && setReduceOnly(false))} disabled={reduceOnly}>
            TP/SL
          </Checkbox>
          <Checkbox checked={reduceOnly} onChange={(v) => (setReduceOnly(v), v && setTpsl(false))}>
            <span data-tip="Only reduces an existing position, never increases it">Reduce-only</span>
          </Checkbox>
          {type === 'LIMIT' && (
            <Checkbox checked={postOnly} onChange={setPostOnly}>
              Post-only
            </Checkbox>
          )}
          {needsPrice && (
            <label className="ticket__tif">
              <span className="faint">TIF</span>
              <select
                value={tif}
                onChange={(e) => setTif(e.target.value as Tif)}
                disabled={postOnly && type === 'LIMIT'}
                aria-label="Time in force"
              >
                <option value="GTC">GTC</option>
                <option value="IOC">IOC</option>
                <option value="FOK">FOK</option>
              </select>
            </label>
          )}
        </div>
        {tpsl && (
          <div className="ticket__tpsl">
            <DecimalInput
              label="Take profit"
              unit={market.quote}
              value={tp}
              onChange={(v) => (setTp(v), setErrors({}))}
              decimals={market.pricePrecision}
              error={errors.tp}
              placeholder="Mark price"
              name="takeProfitPrice"
            />
            <DecimalInput
              label="Stop loss"
              unit={market.quote}
              value={sl}
              onChange={(v) => (setSl(v), setErrors({}))}
              decimals={market.pricePrecision}
              error={errors.sl}
              placeholder="Mark price"
              name="stopLossPrice"
            />
          </div>
        )}
      </div>

      <div className="ticket__info">
        <InfoRow label="Available">
          {authed ? `${formatNumber(available, 2, { truncate: true })} ${settle}` : '—'}
          {authed && (
            <Link className="ticket__deposit" to="/wallet?transfer=FUTURES" aria-label="Transfer to futures">
              ⇄
            </Link>
          )}
        </InfoRow>
        <InfoRow label="Max open">{authed ? `${fmtQty(maxQty.toFixed(), market)} ${market.base}` : '—'}</InfoRow>
        <InfoRow label="Cost" tip="Initial margin + estimated taker fee">
          {cost.gt(0) ? `${formatNumber(cost, 2)} ${settle}` : '—'}
        </InfoRow>
        <InfoRow
          label="Est. liq. long / short"
          tip={
            settings.marginMode === 'CROSS'
              ? 'Cross margin: estimate using your available balance'
              : 'Isolated margin estimate'
          }
        >
          <span className="up">{liqLong ? fmtPrice(liqLong.toFixed(), market) : '—'}</span> /{' '}
          <span className="down">{liqShort ? fmtPrice(liqShort.toFixed(), market) : '—'}</span>
        </InfoRow>
      </div>

      {blocked && authed && <Alert tone="warn">{blocked}</Alert>}
      {errors.form && <Alert tone="error">{errors.form}</Alert>}

      {authed ? (
        <div className="ticket__dual">
          <Button
            variant="buy"
            size="lg"
            block
            loading={place.isPending && place.variables === 'BUY'}
            disabled={Boolean(blocked) || place.isPending}
            onClick={() => submit('BUY')}
          >
            {reduceOnly ? 'Close Short' : 'Open Long'}
          </Button>
          <Button
            variant="sell"
            size="lg"
            block
            loading={place.isPending && place.variables === 'SELL'}
            disabled={Boolean(blocked) || place.isPending}
            onClick={() => submit('SELL')}
          >
            {reduceOnly ? 'Close Long' : 'Open Short'}
          </Button>
        </div>
      ) : (
        <AuthCta />
      )}

      <Modal
        open={confirmSide !== null}
        onClose={() => setConfirmSide(null)}
        title={`Confirm ${confirmSide === 'BUY' ? (reduceOnly ? 'close short' : 'long') : reduceOnly ? 'close long' : 'short'}`}
        footer={
          <>
            <Button onClick={() => setConfirmSide(null)}>Cancel</Button>
            <Button
              variant={confirmSide === 'BUY' ? 'buy' : 'sell'}
              loading={place.isPending}
              onClick={() => {
                if (dontAsk) setConfirmOrders(false);
                if (confirmSide) send(confirmSide);
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <KeyValue
          items={[
            ['Contract', `${market.symbol} · Perpetual`],
            [
              'Side',
              <span key="s" className={confirmSide === 'BUY' ? 'up' : 'down'}>
                {confirmSide === 'BUY' ? 'Buy / Long' : 'Sell / Short'}
              </span>,
            ],
            ['Type', humanize(type)],
            ['Margin', `${settings.marginMode === 'CROSS' ? 'Cross' : 'Isolated'} · ${leverage}x`],
            ...(needsStop
              ? ([
                  ['Trigger', `${fmtPrice(stopPrice, market)} (${workingType === 'MARK_PRICE' ? 'mark' : 'last'})`],
                ] as [string, string][])
              : []),
            ['Price', needsPrice ? `${fmtPrice(price, market)} ${market.quote}` : 'Market'],
            ['Size', `${fmtQty(qty, market)} ${market.base} (≈ ${formatNumber(notional, 2)} ${settle})`],
            ['Cost', `${formatNumber(cost, 2)} ${settle}`],
            ...(tpsl && tp ? ([['Take profit', fmtPrice(tp, market)]] as [string, string][]) : []),
            ...(tpsl && sl ? ([['Stop loss', fmtPrice(sl, market)]] as [string, string][]) : []),
            [
              'Est. liq. price',
              (confirmSide === 'BUY' ? liqLong : liqShort)
                ? fmtPrice((confirmSide === 'BUY' ? liqLong : liqShort)!.toFixed(), market)
                : '—',
            ],
            ...(reduceOnly ? ([['Reduce-only', 'Yes']] as [string, string][]) : []),
          ]}
        />
        <div style={{ marginTop: 14 }}>
          <Checkbox checked={dontAsk} onChange={setDontAsk}>
            Don&apos;t show this confirmation again
          </Checkbox>
        </div>
      </Modal>

      {authed && <LeverageModal open={levOpen} onClose={() => setLevOpen(false)} market={market} settings={settings} />}
      {authed && (
        <MarginModeModal
          open={modeOpen}
          onClose={() => setModeOpen(false)}
          market={market}
          current={settings.marginMode}
        />
      )}
    </div>
  );
}

export function LeverageModal({
  open,
  onClose,
  market,
  settings,
}: {
  open: boolean;
  onClose: () => void;
  market: MarketDto;
  settings: FuturesSettingsDto;
}) {
  const [lev, setLev] = useState(settings.leverage);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (open) setLev(settings.leverage);
  }, [open, settings.leverage]);
  const max = settings.maxLeverage;
  const marks = [1, 5, 10, 20, 25, 50, 75, 100, 125].filter((m) => m <= max);
  if (!marks.includes(max)) marks.push(max);
  const tiers = market.futures?.riskTiers ?? [];
  const maxPosition = tiers
    .filter((t) => t.maxLeverage >= lev)
    .reduce((m, t) => (D(t.maxNotional).gt(m) ? D(t.maxNotional) : m), D(0));
  const save = useMutation({
    mutationFn: () => api.futures.setLeverage(market.symbol, lev),
    onSuccess: (s) => {
      qc.setQueryData(['futures-settings', market.symbol], s);
      void qc.invalidateQueries({ queryKey: ['positions'] });
      toast.success(`Leverage set to ${s.leverage}x`);
      onClose();
    },
    onError: (e) => toast.error('Could not change leverage', errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust leverage"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="lev">
        <div className="lev__value">
          <button
            type="button"
            className="gc-icon-btn"
            onClick={() => setLev((l) => Math.max(1, l - 1))}
            aria-label="Decrease leverage"
          >
            −
          </button>
          <span className="num">{lev}x</span>
          <button
            type="button"
            className="gc-icon-btn"
            onClick={() => setLev((l) => Math.min(max, l + 1))}
            aria-label="Increase leverage"
          >
            +
          </button>
        </div>
        <input
          type="range"
          className="gc-slider"
          min={1}
          max={max}
          value={lev}
          onChange={(e) => setLev(Number(e.target.value))}
          aria-label="Leverage"
          style={{
            background: `linear-gradient(to right, var(--c-brand) ${((lev - 1) / Math.max(1, max - 1)) * 100}%, var(--c-border-strong) 0)`,
          }}
        />
        <div className="lev__marks">
          {marks.map((m) => (
            <button key={m} type="button" className={cx(lev === m && 'on')} onClick={() => setLev(m)}>
              {m}x
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Maximum position at {lev}x:{' '}
          <strong className="num">{maxPosition.gt(0) ? `${formatNumber(maxPosition, 0)} ${market.quote}` : '—'}</strong>
        </p>
        {lev > 20 && (
          <Alert tone="warn">
            Leverage above 20x significantly increases the risk of liquidation. Trade with care.
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export function MarginModeModal({
  open,
  onClose,
  market,
  current,
}: {
  open: boolean;
  onClose: () => void;
  market: MarketDto;
  current: MarginMode;
}) {
  const [mode, setMode] = useState<MarginMode>(current);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (open) setMode(current);
  }, [open, current]);
  const save = useMutation({
    mutationFn: () => api.futures.setMarginMode(market.symbol, mode),
    onSuccess: (s) => {
      qc.setQueryData(['futures-settings', market.symbol], s);
      toast.success(`${market.symbol} margin mode: ${s.marginMode === 'CROSS' ? 'Cross' : 'Isolated'}`);
      onClose();
    },
    onError: (e) => toast.error('Could not change margin mode', errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${market.symbol} margin mode`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={mode === current} onClick={() => save.mutate()}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="mode-pick">
        {(['CROSS', 'ISOLATED'] as MarginMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={cx('mode-pick__opt', mode === m && 'on')}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
          >
            <strong>{m === 'CROSS' ? 'Cross margin' : 'Isolated margin'}</strong>
            <span className="muted">
              {m === 'CROSS'
                ? 'All cross positions share your futures balance as margin. Profits from one position can offset losses of another; a liquidation can consume the whole balance.'
                : 'Margin is limited to the amount assigned to this position. Liquidation only loses that margin; you can add or remove margin manually.'}
            </span>
          </button>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
        The margin mode can only be changed while you have no open position or open orders on this contract.
      </p>
    </Modal>
  );
}
