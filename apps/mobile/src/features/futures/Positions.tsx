import type { FuturesPositionDto, MarketDto } from '@gocrypto/shared-types';
import { D, floorToStep } from '@gocrypto/trading-utils';
import { closePositionSchema, fieldErrors, positionTpSlSchema } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  KeyValue,
  Notice,
  PercentSlider,
  PnLText,
  Sheet,
  SkeletonRows,
  TextField,
  Txt,
} from '../../components';
import { useLastNonNull } from '../../hooks/useCommon';
import { useMarkets } from '../../hooks/useMarketData';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatNumber, formatPercent, formatPrice, formatQty, isPositive, plain, stepDecimals } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';

interface PositionsCardProps {
  positions: FuturesPositionDto[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Open perpetual positions with live PnL, close and TP/SL actions. */
export function PositionsCard({ positions, isPending, error, onRetry }: PositionsCardProps) {
  const s = useStyles();
  const markets = useMarkets('FUTURES');
  const bySymbol = useMemo(() => new Map((markets.data ?? []).map((m) => [m.symbol, m])), [markets.data]);
  const [closing, setClosing] = useState<FuturesPositionDto | null>(null);
  const [editing, setEditing] = useState<FuturesPositionDto | null>(null);

  let content;
  if (isPending) content = <SkeletonRows count={2} avatar={false} />;
  else if (error) content = <ErrorState compact error={error} onRetry={onRetry} />;
  else if (!positions?.length) {
    content = (
      <EmptyState
        compact
        icon="futures"
        title="No open positions"
        message="Positions you open appear here with live PnL."
      />
    );
  } else {
    content = positions.map((p, i) => (
      <View key={p.symbol}>
        {i > 0 ? <Divider /> : null}
        <PositionItem
          position={p}
          market={bySymbol.get(p.symbol)}
          onClose={() => setClosing(p)}
          onTpSl={() => setEditing(p)}
        />
      </View>
    ));
  }

  return (
    <Card padded={false} style={s.card}>
      <View style={s.head}>
        <Txt variant="subtitle">Positions</Txt>
        {positions?.length ? <Badge label={String(positions.length)} tone="brand" /> : null}
      </View>
      <Divider />
      <View style={s.body}>{content}</View>
      <ClosePositionSheet open={closing} markets={bySymbol} onClose={() => setClosing(null)} />
      <TpSlSheet open={editing} markets={bySymbol} onClose={() => setEditing(null)} />
    </Card>
  );
}

function PositionItem({
  position: p,
  market,
  onClose,
  onTpSl,
}: {
  position: FuturesPositionDto;
  market: MarketDto | undefined;
  onClose: () => void;
  onTpSl: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const tick = market?.tickSize ?? '0.01';
  const step = market?.stepSize ?? '0.001';
  const long = p.side === 'LONG';
  const settle = market?.futures?.settleAsset ?? 'USDT';
  return (
    <View style={s.item}>
      <View style={s.itemHead}>
        <View style={[s.sideBar, { backgroundColor: long ? t.colors.up : t.colors.down }]} />
        <Txt variant="subtitle">{p.symbol}</Txt>
        <Badge label={p.side} tone={long ? 'up' : 'down'} />
        <Badge label={`${p.marginMode === 'CROSS' ? 'Cross' : 'Isolated'} ${p.leverage}x`} tone="neutral" />
      </View>
      <View style={s.pnlRow}>
        <View>
          <Txt variant="micro" tone="faint">
            Unrealized PnL ({settle})
          </Txt>
          <PnLText value={p.unrealizedPnl} variant="heading" weight="bold" />
        </View>
        <View style={s.right}>
          <Txt variant="micro" tone="faint">
            ROE
          </Txt>
          <Txt variant="heading" weight="bold" numeric color={D(p.roe).gte(0) ? t.colors.up : t.colors.down}>
            {formatPercent(p.roe)}
          </Txt>
        </View>
      </View>
      <View style={s.grid}>
        <Cell label={`Size (${market?.base ?? ''})`} value={formatQty(D(p.quantity).abs(), step)} />
        <Cell label="Entry price" value={formatPrice(p.entryPrice, tick)} align="center" />
        <Cell label="Mark price" value={formatPrice(p.markPrice, tick)} align="right" />
      </View>
      <View style={s.grid}>
        <Cell
          label="Liq. price"
          value={p.liquidationPrice ? formatPrice(p.liquidationPrice, tick) : '—'}
          color={t.colors.warn}
        />
        <Cell label="Margin" value={formatNumber(p.margin, 2)} align="center" />
        <Cell label="Margin ratio" value={formatPercent(p.marginRatio, 2, false)} align="right" />
      </View>
      {p.takeProfitPrice || p.stopLossPrice ? (
        <Txt variant="caption" tone="muted" style={s.tpsl}>
          TP{' '}
          <Txt variant="caption" tone="up" numeric>
            {p.takeProfitPrice ? formatPrice(p.takeProfitPrice, tick) : '—'}
          </Txt>
          {'  ·  '}SL{' '}
          <Txt variant="caption" tone="down" numeric>
            {p.stopLossPrice ? formatPrice(p.stopLossPrice, tick) : '—'}
          </Txt>
        </Txt>
      ) : null}
      <View style={s.actions}>
        <Button title="TP / SL" size="sm" variant="secondary" onPress={onTpSl} block style={s.flex} />
        <Button title="Close" size="sm" variant="outline" onPress={onClose} block style={s.flex} />
      </View>
    </View>
  );
}

function Cell({
  label,
  value,
  align = 'left',
  color,
}: {
  label: string;
  value: string;
  align?: 'left' | 'center' | 'right';
  color?: string;
}) {
  const s = useStyles();
  return (
    <View style={[s.cell, { alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }]}>
      <Txt variant="micro" tone="faint" numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="label" weight="medium" numeric color={color} numberOfLines={1} style={s.cellValue}>
        {value}
      </Txt>
    </View>
  );
}

interface PositionSheetProps {
  /** Position to act on; null closes the sheet. */
  open: FuturesPositionDto | null;
  markets: Map<string, MarketDto>;
  onClose: () => void;
}

function ClosePositionSheet({ open, markets, onClose }: PositionSheetProps) {
  const s = useStyles();
  const qc = useQueryClient();
  // Keep rendering the last position while the sheet animates out.
  const position = useLastNonNull(open);
  const market = position ? markets.get(position.symbol) : undefined;
  const step = market?.stepSize ?? '0.001';
  const full = position ? D(position.quantity).abs().toFixed() : '0';
  const [qty, setQty] = useState('');
  const [pct, setPct] = useState(100);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQty(plain(D(open.quantity).abs().toFixed()));
      setPct(100);
      setError(null);
    }
  }, [open]);

  const close = useMutation({
    mutationFn: (args: { symbol: string; quantity?: string }) => api.futures.closePosition(args.symbol, args.quantity),
    onSuccess: (res) => {
      haptics.success();
      const o = res.order;
      toast.success(
        'Close order sent',
        `${o.symbol} · ${formatQty(isPositive(o.filledQuantity) ? o.filledQuantity : o.quantity, step)} at market`,
      );
      void qc.invalidateQueries({ queryKey: qk.futures });
      void qc.invalidateQueries({ queryKey: qk.orders });
      onClose();
    },
    onError: (e) => {
      haptics.error();
      setError(errorMessage(e));
    },
  });

  if (!position) return null;
  const isFull = qty !== '' && D(qty || '0').eq(full);

  const submit = () => {
    const parsed = closePositionSchema.safeParse({
      quantity: isFull ? undefined : qty.replace(/\.$/, '') || undefined,
    });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed.error))[0] ?? 'Enter a valid size');
      return;
    }
    if (!isFull && !parsed.data.quantity) {
      setError('Enter the size to close');
      return;
    }
    close.mutate({ symbol: position.symbol, quantity: parsed.data.quantity });
  };

  return (
    <Sheet
      visible={open !== null}
      onClose={onClose}
      title={`Close ${position.symbol}`}
      subtitle={`${position.side} · ${position.leverage}x`}
      dismissible={!close.isPending}
      footer={
        <Button
          title={isFull ? 'Market close all' : 'Market close'}
          variant={position.side === 'LONG' ? 'sell' : 'buy'}
          onPress={submit}
          loading={close.isPending}
        />
      }
    >
      <KeyValue label="Position size" value={`${formatQty(full, step)} ${market?.base ?? ''}`} />
      <KeyValue label="Mark price" value={formatPrice(position.markPrice, market?.tickSize ?? '0.01')} />
      <KeyValue label="Unrealized PnL">
        <PnLText variant="label" weight="medium" value={position.unrealizedPnl} />
      </KeyValue>
      <TextField
        label="Size to close"
        dense
        decimal
        maxDecimals={stepDecimals(step)}
        value={qty}
        onChangeText={(v) => {
          setQty(v);
          setError(null);
          setPct(D(full).gt(0) && v ? Math.min(100, Math.round(D(v).div(full).mul(100).toNumber())) : 0);
        }}
        suffix={market?.base}
        containerStyle={s.closeField}
      />
      <PercentSlider
        value={pct}
        onChange={(p) => {
          setPct(p);
          setError(null);
          setQty(p === 100 ? plain(full) : plain(floorToStep(D(full).mul(p).div(100), step)));
        }}
      />
      {error ? <Notice tone="down" message={error} style={s.notice} /> : null}
    </Sheet>
  );
}

function TpSlSheet({ open, markets, onClose }: PositionSheetProps) {
  const s = useStyles();
  const qc = useQueryClient();
  const position = useLastNonNull(open);
  const market = position ? markets.get(position.symbol) : undefined;
  const tick = market?.tickSize ?? '0.01';
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTp(plain(open.takeProfitPrice));
      setSl(plain(open.stopLossPrice));
      setErrors({});
      setError(null);
    }
  }, [open]);

  const save = useMutation({
    mutationFn: (args: { symbol: string; takeProfitPrice: string | null; stopLossPrice: string | null }) =>
      api.futures.setTpSl(args.symbol, { takeProfitPrice: args.takeProfitPrice, stopLossPrice: args.stopLossPrice }),
    onSuccess: () => {
      haptics.success();
      toast.success('TP/SL updated');
      void qc.invalidateQueries({ queryKey: qk.futures });
      void qc.invalidateQueries({ queryKey: qk.orders });
      onClose();
    },
    onError: (e) => {
      haptics.error();
      setError(errorMessage(e));
    },
  });

  if (!position) return null;

  const submit = () => {
    const body = {
      takeProfitPrice: tp.replace(/\.$/, '') || null,
      stopLossPrice: sl.replace(/\.$/, '') || null,
    };
    const parsed = positionTpSlSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate({ symbol: position.symbol, takeProfitPrice: body.takeProfitPrice, stopLossPrice: body.stopLossPrice });
  };

  return (
    <Sheet
      visible={open !== null}
      onClose={onClose}
      title="Take profit / Stop loss"
      subtitle={`${position.symbol} · ${position.side}`}
      dismissible={!save.isPending}
      footer={<Button title="Save" onPress={submit} loading={save.isPending} />}
    >
      <KeyValue label="Entry price" value={formatPrice(position.entryPrice, tick)} />
      <KeyValue label="Mark price" value={formatPrice(position.markPrice, tick)} />
      <View style={s.tpslFields}>
        <TextField
          label="Take profit"
          dense
          decimal
          maxDecimals={stepDecimals(tick)}
          value={tp}
          onChangeText={setTp}
          error={errors.takeProfitPrice}
          placeholder="None"
          hint="Leave empty to remove"
        />
        <TextField
          label="Stop loss"
          dense
          decimal
          maxDecimals={stepDecimals(tick)}
          value={sl}
          onChangeText={setSl}
          error={errors.stopLossPrice}
          placeholder="None"
          hint="Leave empty to remove"
        />
      </View>
      <Txt variant="caption" tone="faint">
        Triggers close the whole position at market when the mark price reaches the level.
      </Txt>
      {error ? <Notice tone="down" message={error} style={s.notice} /> : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  card: {
    marginTop: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  item: {
    paddingVertical: 14,
  },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sideBar: {
    width: 3,
    height: 18,
    borderRadius: 2,
  },
  pnlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  right: {
    alignItems: 'flex-end',
  },
  grid: {
    flexDirection: 'row',
    marginTop: 10,
  },
  cell: {
    flex: 1,
  },
  cellValue: {
    marginTop: 2,
  },
  tpsl: {
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  flex: {
    flex: 1,
  },
  closeField: {
    marginTop: 12,
    marginBottom: 6,
  },
  notice: {
    marginTop: 12,
  },
  tpslFields: {
    marginTop: 12,
  },
}));
