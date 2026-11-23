import type { MarginMode, MarketDto, OrderSide } from '@gocrypto/shared-types';
import { D, floorToStep } from '@gocrypto/trading-utils';
import { fieldErrors, futuresOrderSchema, type FuturesOrderInput } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  KeyValue,
  Notice,
  PercentSlider,
  SegmentedControl,
  TextField,
} from '../../components';
import { useUserSettings } from '../../hooks/useAccount';
import { useLastNonNull } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { apiFieldErrors, errorMessage } from '../../lib/errors';
import {
  formatNumber,
  formatPercent,
  formatPrice,
  formatQty,
  humanize,
  isPositive,
  plain,
  stepDecimals,
} from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';
import { OrderReviewSheet, type ReviewRow } from '../trade/OrderReviewSheet';

type FuturesType = 'LIMIT' | 'MARKET';

interface FuturesOrderFormProps {
  market: MarketDto;
  lastPrice: string | null | undefined;
  leverage: number;
  marginMode: MarginMode;
  availableBalance: string;
  tradingEnabled: boolean;
  onPressLeverage: () => void;
  onPressMarginMode: () => void;
}

function field(v: string): string | undefined {
  const s = v.trim().replace(/\.$/, '');
  return s === '' ? undefined : s;
}

/**
 * Long/Short order entry. Size helpers (percentage of buying power, cost estimate) are display-only
 * conveniences; margin and risk checks are enforced by the server.
 */
export function FuturesOrderForm({
  market,
  lastPrice,
  leverage,
  marginMode,
  availableBalance,
  tradingEnabled,
  onPressLeverage,
  onPressMarginMode,
}: FuturesOrderFormProps) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [side, setSide] = useState<OrderSide>('BUY');
  const [type, setType] = useState<FuturesType>('LIMIT');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [pct, setPct] = useState(0);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<FuturesOrderInput | null>(null);
  const shownReview = useLastNonNull(review);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const settings = useUserSettings();
  const settle = market.futures?.settleAsset ?? market.quote;
  const priceDp = stepDecimals(market.tickSize);
  const qtyDp = stepDecimals(market.stepSize);
  const isLong = side === 'BUY';

  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    setQty('');
    setPrice('');
    setPct(0);
    setTp('');
    setSl('');
    setErrors({});
    prefilledFor.current = null;
  }, [market.symbol]);
  useEffect(() => {
    if (prefilledFor.current === market.symbol || !lastPrice || !isPositive(lastPrice)) return;
    prefilledFor.current = market.symbol;
    setPrice(plain(floorToStep(lastPrice, market.tickSize)));
  }, [market.symbol, market.tickSize, lastPrice]);

  const refPrice = (): string | null => {
    const p = type === 'MARKET' ? lastPrice : (field(price) ?? lastPrice);
    return p && isPositive(p) ? p : null;
  };

  /** Max size the available balance can open at the current leverage (estimate). */
  const maxQty = (): string | null => {
    const px = refPrice();
    if (!px || !isPositive(availableBalance)) return null;
    return plain(floorToStep(D(availableBalance).mul(leverage).div(px), market.stepSize)) || '0';
  };

  const applyPct = (p: number) => {
    setPct(p);
    setErrors({});
    const max = maxQty();
    if (max) setQty(plain(floorToStep(D(max).mul(p).div(100), market.stepSize)));
  };

  const onQty = (v: string) => {
    setQty(v);
    setErrors({});
    const max = maxQty();
    setPct(max && isPositive(max) && isPositive(v) ? Math.min(100, Math.round(D(v).div(max).mul(100).toNumber())) : 0);
  };

  const place = useMutation({
    mutationFn: (body: FuturesOrderInput) => api.futures.place(body),
    onSuccess: (res) => {
      const o = res.order;
      setReview(null);
      setSubmitError(null);
      setQty('');
      setPct(0);
      setTp('');
      setSl('');
      void qc.invalidateQueries({ queryKey: qk.orders });
      void qc.invalidateQueries({ queryKey: qk.futures });
      if (o.status === 'REJECTED') {
        haptics.error();
        toast.error('Order rejected', o.rejectReason ?? 'The order was rejected.');
        return;
      }
      haptics.success();
      const what = `${o.side === 'BUY' ? 'Long' : 'Short'} ${formatQty(o.quantity, market.stepSize)} ${market.base}`;
      if (o.status === 'FILLED')
        toast.success(
          `${o.reduceOnly ? 'Reduced' : 'Opened'} ${what}`,
          `Average price ${formatPrice(o.avgPrice, market.tickSize)}`,
        );
      else toast.success(`${humanize(o.type)} order placed`, `${what} @ ${formatPrice(o.price, market.tickSize)}`);
    },
    onError: (e) => {
      haptics.error();
      setErrors(apiFieldErrors(e));
      const message = errorMessage(e);
      if (review) setSubmitError(message);
      else toast.error('Order failed', message);
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    const body = {
      symbol: market.symbol,
      side,
      type,
      price: type === 'LIMIT' ? field(price) : undefined,
      timeInForce: type === 'LIMIT' ? ('GTC' as const) : undefined,
      quantity: field(qty),
      reduceOnly: reduceOnly || undefined,
      takeProfitPrice: tpsl && !reduceOnly ? field(tp) : undefined,
      stopLossPrice: tpsl && !reduceOnly ? field(sl) : undefined,
    };
    const parsed = futuresOrderSchema.safeParse(body);
    if (!parsed.success) {
      haptics.warning();
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitError(null);
    if (settings.data?.confirmOrders === false) place.mutate(parsed.data);
    else setReview(parsed.data);
  };

  const px = refPrice();
  const notional = px && isPositive(field(qty)) ? D(qty).mul(px) : null;
  const cost = notional ? notional.div(leverage) : null;
  const max = maxQty();

  const reviewRows: ReviewRow[] = shownReview
    ? [
        {
          label: 'Side',
          value: shownReview.side === 'BUY' ? 'Long' : 'Short',
          tone: shownReview.side === 'BUY' ? 'up' : 'down',
        },
        { label: 'Type', value: humanize(shownReview.type) },
        {
          label: 'Price',
          value: shownReview.price ? `${formatPrice(shownReview.price, market.tickSize)} ${settle}` : 'Market',
        },
        { label: 'Size', value: `${formatQty(shownReview.quantity, market.stepSize)} ${market.base}` },
        ...(notional ? [{ label: 'Notional ≈', value: `${formatNumber(notional, 2)} ${settle}` }] : []),
        { label: 'Leverage', value: `${leverage}x · ${marginMode === 'CROSS' ? 'Cross' : 'Isolated'}` },
        ...(cost ? [{ label: 'Margin ≈', value: `${formatNumber(cost, 2)} ${settle}` }] : []),
        ...(shownReview.takeProfitPrice
          ? [
              {
                label: 'Take profit',
                value: formatPrice(shownReview.takeProfitPrice, market.tickSize),
                tone: 'up' as const,
              },
            ]
          : []),
        ...(shownReview.stopLossPrice
          ? [
              {
                label: 'Stop loss',
                value: formatPrice(shownReview.stopLossPrice, market.tickSize),
                tone: 'down' as const,
              },
            ]
          : []),
        ...(shownReview.reduceOnly ? [{ label: 'Reduce-only', value: 'Yes' }] : []),
        {
          label: 'Fees',
          value: `Maker ${formatPercent(market.makerFeeRate, 3, false)} · Taker ${formatPercent(market.takerFeeRate, 3, false)}`,
          tone: 'muted',
        },
      ]
    : [];

  return (
    <Card>
      <View style={s.controls}>
        <Chip label={marginMode === 'CROSS' ? 'Cross' : 'Isolated'} icon="chevron-down" onPress={onPressMarginMode} />
        <Chip label={`${leverage}x`} icon="chevron-down" onPress={onPressLeverage} />
      </View>
      <SegmentedControl
        options={[
          { value: 'BUY', label: 'Long', activeColor: t.colors.up },
          { value: 'SELL', label: 'Short', activeColor: t.colors.down },
        ]}
        value={side}
        onChange={(v) => {
          setSide(v);
          setErrors({});
        }}
      />
      <SegmentedControl
        size="sm"
        style={s.types}
        options={[
          { value: 'LIMIT', label: 'Limit' },
          { value: 'MARKET', label: 'Market' },
        ]}
        value={type}
        onChange={(v) => {
          setType(v);
          setErrors({});
          if (v === 'LIMIT' && !price && lastPrice) setPrice(plain(floorToStep(lastPrice, market.tickSize)));
        }}
      />
      {type === 'LIMIT' ? (
        <TextField
          label="Price"
          dense
          decimal
          maxDecimals={priceDp}
          value={price}
          onChangeText={(v) => {
            setPrice(v);
            setErrors({});
          }}
          suffix={settle}
          error={errors.price}
          placeholder="0.00"
        />
      ) : null}
      <TextField
        label="Size"
        dense
        decimal
        maxDecimals={qtyDp}
        value={qty}
        onChangeText={onQty}
        suffix={market.base}
        error={errors.quantity}
        placeholder={formatQty('0', market.stepSize)}
      />
      <PercentSlider
        value={pct}
        onChange={applyPct}
        color={isLong ? t.colors.up : t.colors.down}
        disabled={!tradingEnabled}
      />

      <View style={s.summary}>
        <KeyValue label="Available" value={`${formatNumber(availableBalance, 2)} ${settle}`} />
        <KeyValue
          label="Max size ≈"
          value={max ? `${formatQty(max, market.stepSize)} ${market.base}` : '—'}
          valueTone="muted"
        />
        <KeyValue label="Margin ≈" value={cost ? `${formatNumber(cost, 2)} ${settle}` : '—'} />
      </View>

      <View style={s.options}>
        <Checkbox
          checked={reduceOnly}
          onChange={(v) => {
            setReduceOnly(v);
            if (v) setTpsl(false);
          }}
          label="Reduce-only"
        />
        <Checkbox checked={tpsl} onChange={setTpsl} label="TP / SL" disabled={reduceOnly} />
      </View>
      {tpsl && !reduceOnly ? (
        <View style={s.tpsl}>
          <TextField
            label="Take profit"
            dense
            decimal
            maxDecimals={priceDp}
            value={tp}
            onChangeText={(v) => {
              setTp(v);
              setErrors({});
            }}
            error={errors.takeProfitPrice}
            placeholder="Trigger price"
            containerStyle={s.flex}
          />
          <TextField
            label="Stop loss"
            dense
            decimal
            maxDecimals={priceDp}
            value={sl}
            onChangeText={(v) => {
              setSl(v);
              setErrors({});
            }}
            error={errors.stopLossPrice}
            placeholder="Trigger price"
            containerStyle={s.flex}
          />
        </View>
      ) : null}

      {!tradingEnabled ? (
        <Notice tone="warn" message="Trading is disabled for your account. Contact support." style={s.notice} />
      ) : null}

      <Button
        title={isLong ? 'Open long' : 'Open short'}
        variant={isLong ? 'buy' : 'sell'}
        onPress={submit}
        loading={place.isPending && !review}
        disabled={!tradingEnabled}
        size="lg"
        style={s.submit}
      />

      <OrderReviewSheet
        visible={review !== null}
        onClose={() => {
          if (!place.isPending) {
            setReview(null);
            setSubmitError(null);
          }
        }}
        title={`${isLong ? 'Long' : 'Short'} ${market.base}`}
        subtitle={market.displayName}
        side={side}
        rows={reviewRows}
        confirmLabel={isLong ? 'Confirm long' : 'Confirm short'}
        loading={place.isPending}
        error={submitError}
        warning={leverage >= 20 ? `You are trading with ${leverage}x leverage.` : null}
        onConfirm={() => {
          if (review) {
            haptics.medium();
            place.mutate(review);
          }
        }}
      />
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  controls: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  types: {
    marginTop: 10,
    marginBottom: 14,
  },
  summary: {
    marginTop: 8,
  },
  options: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 12,
  },
  tpsl: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  flex: {
    flex: 1,
  },
  notice: {
    marginTop: 12,
  },
  submit: {
    marginTop: 14,
  },
}));
