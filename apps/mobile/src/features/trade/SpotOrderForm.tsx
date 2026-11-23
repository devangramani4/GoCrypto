import type { MarketDto, OrderSide, PlaceOrderResult } from '@gocrypto/shared-types';
import { D, floorToStep } from '@gocrypto/trading-utils';
import { fieldErrors, spotOrderSchema, type SpotOrderInput } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import {
  Button,
  Card,
  Checkbox,
  KeyValue,
  Notice,
  PercentSlider,
  SegmentedControl,
  TextField,
  Txt,
} from '../../components';
import { availableOf, useBalances, useUserSettings } from '../../hooks/useAccount';
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
import { OrderReviewSheet, type ReviewRow } from './OrderReviewSheet';

type SpotType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT';

interface SpotOrderFormProps {
  market: MarketDto;
  lastPrice: string | null | undefined;
  /** Price tapped in the order book (nonce re-applies the same price). */
  picked: { price: string; nonce: number } | null;
  tradingEnabled: boolean;
}

/** '' → undefined and "1." → "1" so the zod schema reports "required" instead of "invalid". */
function field(v: string): string | undefined {
  const s = v.trim().replace(/\.$/, '');
  return s === '' ? undefined : s;
}

export function SpotOrderForm({ market, lastPrice, picked, tradingEnabled }: SpotOrderFormProps) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [side, setSide] = useState<OrderSide>('BUY');
  const [type, setType] = useState<SpotType>('LIMIT');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [total, setTotal] = useState('');
  const [pct, setPct] = useState(0);
  const [postOnly, setPostOnly] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<SpotOrderInput | null>(null);
  const shownReview = useLastNonNull(review);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const balances = useBalances('SPOT');
  const settings = useUserSettings();
  const quoteAvail = availableOf(balances.data, market.quote);
  const baseAvail = availableOf(balances.data, market.base);
  const isBuy = side === 'BUY';
  const marketBuy = type === 'MARKET' && isBuy;
  const priceDp = stepDecimals(market.tickSize);
  const qtyDp = stepDecimals(market.stepSize);

  // New market: clear the form; prefill the limit price once a last price is known.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    setAmount('');
    setTotal('');
    setStopPrice('');
    setPrice('');
    setPct(0);
    setErrors({});
    prefilledFor.current = null;
  }, [market.symbol]);
  useEffect(() => {
    if (prefilledFor.current === market.symbol || !lastPrice || !isPositive(lastPrice)) return;
    prefilledFor.current = market.symbol;
    setPrice(plain(floorToStep(lastPrice, market.tickSize)));
  }, [market.symbol, market.tickSize, lastPrice]);

  useEffect(() => {
    if (!picked) return;
    setPrice(plain(picked.price));
    setType((ty) => (ty === 'MARKET' ? 'LIMIT' : ty));
    setErrors({});
  }, [picked]);

  /** Price used to convert between quote and base amounts (display helpers only). */
  const refPrice = (): string | null => {
    const p = type === 'MARKET' ? lastPrice : (field(price) ?? lastPrice);
    return p && isPositive(p) ? p : null;
  };

  const applyPct = (p: number) => {
    setPct(p);
    setErrors({});
    const ratio = D(p).div(100);
    if (!isBuy) {
      setAmount(plain(floorToStep(D(baseAvail).mul(ratio), market.stepSize)));
      return;
    }
    if (marketBuy) {
      setTotal(plain(floorToStep(D(quoteAvail).mul(ratio), market.tickSize)));
      return;
    }
    const px = refPrice();
    if (px) setAmount(plain(floorToStep(D(quoteAvail).mul(ratio).div(px), market.stepSize)));
  };

  const pctOf = (value: string, max: string): number => {
    if (!isPositive(value) || !isPositive(max)) return 0;
    return Math.min(100, Math.round(D(value).div(max).mul(100).toNumber()));
  };

  const onAmount = (v: string) => {
    setAmount(v);
    setErrors({});
    if (isBuy) {
      const px = refPrice();
      setPct(
        px
          ? pctOf(
              D(v || '0')
                .mul(px)
                .toFixed(),
              quoteAvail,
            )
          : 0,
      );
    } else setPct(pctOf(v, baseAvail));
  };

  const onTotal = (v: string) => {
    setTotal(v);
    setErrors({});
    setPct(pctOf(v, quoteAvail));
  };

  const resetAmounts = () => {
    setAmount('');
    setTotal('');
    setPct(0);
    setErrors({});
  };

  const place = useMutation({
    mutationFn: (body: SpotOrderInput) => api.spot.place(body),
    onSuccess: (res: PlaceOrderResult) => {
      const o = res.order;
      setReview(null);
      setSubmitError(null);
      resetAmounts();
      void qc.invalidateQueries({ queryKey: qk.orders });
      void qc.invalidateQueries({ queryKey: qk.balances('SPOT') });
      void qc.invalidateQueries({ queryKey: qk.fills });
      if (o.status === 'REJECTED') {
        haptics.error();
        toast.error('Order rejected', o.rejectReason ?? 'The order was rejected by the matching engine.');
        return;
      }
      haptics.success();
      if (o.status === 'FILLED') {
        toast.success(
          `${o.side === 'BUY' ? 'Bought' : 'Sold'} ${formatQty(o.filledQuantity, market.stepSize)} ${market.base}`,
          `Average price ${formatPrice(o.avgPrice, market.tickSize)} ${market.quote}`,
        );
      } else {
        toast.success(
          `${humanize(o.type)} ${o.side.toLowerCase()} order placed`,
          o.quantity
            ? `${formatQty(o.quantity, market.stepSize)} ${market.base} @ ${formatPrice(o.price ?? o.stopPrice, market.tickSize)}`
            : undefined,
        );
      }
    },
    onError: (e) => {
      haptics.error();
      const fe = apiFieldErrors(e);
      setErrors(fe);
      const message = errorMessage(e);
      if (review) setSubmitError(message);
      else toast.error('Order failed', message);
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    const base = { symbol: market.symbol, side };
    const body =
      type === 'LIMIT'
        ? {
            ...base,
            type,
            price: field(price),
            quantity: field(amount),
            timeInForce: 'GTC' as const,
            postOnly: postOnly || undefined,
          }
        : type === 'STOP_LIMIT'
          ? {
              ...base,
              type,
              stopPrice: field(stopPrice),
              price: field(price),
              quantity: field(amount),
              timeInForce: 'GTC' as const,
            }
          : isBuy
            ? { ...base, type, quoteQuantity: field(total) }
            : { ...base, type, quantity: field(amount) };
    const parsed = spotOrderSchema.safeParse(body);
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

  const limitTotal =
    type !== 'MARKET' && isPositive(field(price)) && isPositive(field(amount)) ? D(price).mul(amount) : null;
  const px = refPrice();
  const estimate =
    type === 'MARKET' && px
      ? isBuy
        ? isPositive(field(total))
          ? `≈ ${formatQty(D(total).div(px), market.stepSize)} ${market.base}`
          : null
        : isPositive(field(amount))
          ? `≈ ${formatNumber(D(amount).mul(px), priceDp)} ${market.quote}`
          : null
      : null;

  const reviewRows: ReviewRow[] = shownReview
    ? [
        { label: 'Type', value: humanize(shownReview.type) },
        ...(shownReview.stopPrice
          ? [
              {
                label: 'Trigger price',
                value: `${formatPrice(shownReview.stopPrice, market.tickSize)} ${market.quote}`,
              },
            ]
          : []),
        {
          label: 'Price',
          value: shownReview.price ? `${formatPrice(shownReview.price, market.tickSize)} ${market.quote}` : 'Market',
        },
        ...(shownReview.quantity
          ? [{ label: 'Amount', value: `${formatQty(shownReview.quantity, market.stepSize)} ${market.base}` }]
          : []),
        ...(shownReview.quoteQuantity
          ? [{ label: 'Spend', value: `${formatNumber(shownReview.quoteQuantity, priceDp)} ${market.quote}` }]
          : []),
        ...(shownReview.price && shownReview.quantity
          ? [
              {
                label: 'Total',
                value: `${formatNumber(D(shownReview.price).mul(shownReview.quantity), priceDp)} ${market.quote}`,
              },
            ]
          : []),
        ...(shownReview.postOnly ? [{ label: 'Post-only', value: 'Yes' }] : []),
        {
          label: 'Fees',
          value: `Maker ${formatPercent(market.makerFeeRate, 2, false)} · Taker ${formatPercent(market.takerFeeRate, 2, false)}`,
          tone: 'muted',
        },
      ]
    : [];

  const sideColor = isBuy ? t.colors.up : t.colors.down;

  return (
    <Card>
      <SegmentedControl
        options={[
          { value: 'BUY', label: 'Buy', activeColor: t.colors.up },
          { value: 'SELL', label: 'Sell', activeColor: t.colors.down },
        ]}
        value={side}
        onChange={(v) => {
          setSide(v);
          resetAmounts();
        }}
      />
      <SegmentedControl
        size="sm"
        style={s.types}
        options={[
          { value: 'LIMIT', label: 'Limit' },
          { value: 'MARKET', label: 'Market' },
          { value: 'STOP_LIMIT', label: 'Stop-limit' },
        ]}
        value={type}
        onChange={(v) => {
          setType(v);
          resetAmounts();
          if (v !== 'MARKET' && !price && lastPrice) setPrice(plain(floorToStep(lastPrice, market.tickSize)));
        }}
      />

      {type === 'STOP_LIMIT' ? (
        <TextField
          label="Trigger price"
          dense
          decimal
          maxDecimals={priceDp}
          value={stopPrice}
          onChangeText={(v) => {
            setStopPrice(v);
            setErrors({});
          }}
          suffix={market.quote}
          placeholder="0.00"
          error={errors.stopPrice}
        />
      ) : null}
      {type !== 'MARKET' ? (
        <TextField
          label={type === 'STOP_LIMIT' ? 'Limit price' : 'Price'}
          dense
          decimal
          maxDecimals={priceDp}
          value={price}
          onChangeText={(v) => {
            setPrice(v);
            setErrors({});
          }}
          suffix={market.quote}
          placeholder="0.00"
          error={errors.price}
        />
      ) : (
        <View style={s.marketPrice}>
          <Txt variant="label" tone="muted">
            Price
          </Txt>
          <Txt variant="label" weight="semibold">
            Best market price
          </Txt>
        </View>
      )}

      {marketBuy ? (
        <TextField
          label="Total"
          dense
          decimal
          maxDecimals={priceDp}
          value={total}
          onChangeText={onTotal}
          suffix={market.quote}
          placeholder="0.00"
          error={errors.quoteQuantity ?? errors.quantity}
        />
      ) : (
        <TextField
          label="Amount"
          dense
          decimal
          maxDecimals={qtyDp}
          value={amount}
          onChangeText={onAmount}
          suffix={market.base}
          placeholder={formatQty('0', market.stepSize)}
          error={errors.quantity}
        />
      )}

      <PercentSlider value={pct} onChange={applyPct} color={sideColor} disabled={!tradingEnabled} />

      <View style={s.summary}>
        <KeyValue
          label="Available"
          value={
            isBuy
              ? `${formatNumber(quoteAvail, priceDp)} ${market.quote}`
              : `${formatQty(baseAvail, market.stepSize)} ${market.base}`
          }
        />
        {type !== 'MARKET' ? (
          <KeyValue label="Total" value={limitTotal ? `${formatNumber(limitTotal, priceDp)} ${market.quote}` : '—'} />
        ) : (
          <KeyValue label="Estimated" value={estimate ?? '—'} valueTone="muted" />
        )}
      </View>

      {type === 'LIMIT' ? (
        <Checkbox checked={postOnly} onChange={setPostOnly} label="Post-only (maker)" style={s.postOnly} />
      ) : null}

      {!tradingEnabled ? (
        <Notice tone="warn" message="Trading is disabled for your account. Contact support." style={s.notice} />
      ) : null}

      <Button
        title={`${isBuy ? 'Buy' : 'Sell'} ${market.base}`}
        variant={isBuy ? 'buy' : 'sell'}
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
        title={`${isBuy ? 'Buy' : 'Sell'} ${market.base}`}
        subtitle={market.displayName}
        side={side}
        rows={reviewRows}
        confirmLabel={`Confirm ${isBuy ? 'buy' : 'sell'}`}
        loading={place.isPending}
        error={submitError}
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
  types: {
    marginTop: 10,
    marginBottom: 14,
  },
  marketPrice: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 42,
    marginBottom: 14,
  },
  summary: {
    marginTop: 8,
  },
  postOnly: {
    marginTop: 10,
  },
  notice: {
    marginTop: 12,
  },
  submit: {
    marginTop: 14,
  },
}));
