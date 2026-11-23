import type { PriceLevel } from '@gocrypto/shared-types';
import { D, ZERO, type Decimal } from '@gocrypto/trading-utils';
import { memo, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { ErrorState, Skeleton, Txt } from '../../components';
import { useOrderBook, usePublicTrades } from '../../hooks/useMarketData';
import { fmtTime, formatPercent, formatPrice, formatQty } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { makeStyles, useTheme } from '../../theme';

interface BookProps {
  symbol: string;
  tickSize: string;
  stepSize: string;
  rows?: number;
  /** Tap a level to use its price in the order form. */
  onPickPrice?: (price: string) => void;
}

interface Level {
  price: string;
  qty: string;
  /** Cumulative depth / max cumulative depth, 0–1 (display only). */
  depth: number;
}

function withDepth(levels: PriceLevel[], max: Decimal): Level[] {
  let cum = ZERO;
  return levels.map(([price, qty]) => {
    cum = cum.plus(qty);
    return { price, qty, depth: max.gt(0) ? Math.min(1, cum.div(max).toNumber()) : 0 };
  });
}

function total(levels: PriceLevel[]): Decimal {
  return levels.reduce((acc, [, q]) => acc.plus(q), ZERO);
}

/** Side-by-side depth ladder (bids | asks) with cumulative depth bars and the spread. */
function OrderBookViewImpl({ symbol, tickSize, stepSize, rows = 10, onPickPrice }: BookProps) {
  const t = useTheme();
  const s = useStyles();
  const { data, isPending, isError, error, refetch } = useOrderBook(symbol);

  const view = useMemo(() => {
    const bids = (data?.bids ?? []).slice(0, rows);
    const asks = (data?.asks ?? []).slice(0, rows);
    const maxCum = Decimal_max(total(bids), total(asks));
    const bestBid = bids[0]?.[0];
    const bestAsk = asks[0]?.[0];
    let spread: string | null = null;
    let spreadPct: string | null = null;
    if (bestBid && bestAsk) {
      const sp = D(bestAsk).minus(bestBid);
      spread = sp.toFixed();
      spreadPct = D(bestAsk).gt(0) ? sp.div(bestAsk).toFixed() : null;
    }
    return { bids: withDepth(bids, maxCum), asks: withDepth(asks, maxCum), spread, spreadPct };
  }, [data, rows]);

  if (isPending) {
    return (
      <View style={s.skeleton}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={14} style={s.skeletonRow} />
        ))}
      </View>
    );
  }
  if (isError) return <ErrorState compact error={error} onRetry={() => void refetch()} />;

  const pick = (price: string) => {
    if (!onPickPrice) return;
    haptics.selection();
    onPickPrice(price);
  };

  return (
    <View>
      <View style={s.header}>
        <Txt variant="micro" tone="faint" style={s.flex}>
          Bid size
        </Txt>
        <Txt variant="micro" tone="faint" style={s.flex} align="right">
          Bid
        </Txt>
        <View style={s.gap} />
        <Txt variant="micro" tone="faint" style={s.flex}>
          Ask
        </Txt>
        <Txt variant="micro" tone="faint" style={s.flex} align="right">
          Ask size
        </Txt>
      </View>
      <View style={s.columns}>
        <View style={s.flex}>
          {view.bids.map((l) => (
            <Pressable
              key={`b${l.price}`}
              onPress={() => pick(l.price)}
              style={s.row}
              accessibilityLabel={`Bid ${l.price}`}
            >
              <View
                style={[s.depth, s.depthRight, { width: `${l.depth * 100}%`, backgroundColor: t.colors.upDepth }]}
              />
              <Txt variant="caption" numeric style={s.flex} numberOfLines={1}>
                {formatQty(l.qty, stepSize)}
              </Txt>
              <Txt variant="caption" numeric color={t.colors.up} weight="medium" numberOfLines={1}>
                {formatPrice(l.price, tickSize)}
              </Txt>
            </Pressable>
          ))}
          {view.bids.length === 0 ? <EmptySide /> : null}
        </View>
        <View style={s.gap} />
        <View style={s.flex}>
          {view.asks.map((l) => (
            <Pressable
              key={`a${l.price}`}
              onPress={() => pick(l.price)}
              style={s.row}
              accessibilityLabel={`Ask ${l.price}`}
            >
              <View
                style={[s.depth, s.depthLeft, { width: `${l.depth * 100}%`, backgroundColor: t.colors.downDepth }]}
              />
              <Txt variant="caption" numeric color={t.colors.down} weight="medium" style={s.flex} numberOfLines={1}>
                {formatPrice(l.price, tickSize)}
              </Txt>
              <Txt variant="caption" numeric numberOfLines={1}>
                {formatQty(l.qty, stepSize)}
              </Txt>
            </Pressable>
          ))}
          {view.asks.length === 0 ? <EmptySide /> : null}
        </View>
      </View>
      <View style={s.spread}>
        <Txt variant="micro" tone="faint">
          Spread
        </Txt>
        <Txt variant="micro" numeric tone="muted">
          {view.spread ? `${formatPrice(view.spread, tickSize)}  (${formatPercent(view.spreadPct, 3, false)})` : '—'}
        </Txt>
      </View>
    </View>
  );
}

function Decimal_max(a: Decimal, b: Decimal): Decimal {
  return a.gt(b) ? a : b;
}

function EmptySide() {
  const s = useStyles();
  return (
    <View style={s.row}>
      <Txt variant="caption" tone="faint">
        No orders
      </Txt>
    </View>
  );
}

export const OrderBookView = memo(OrderBookViewImpl);

interface TradesProps {
  symbol: string;
  tickSize: string;
  stepSize: string;
  rows?: number;
}

/** Latest public trades (taker side colored). */
function RecentTradesViewImpl({ symbol, tickSize, stepSize, rows = 18 }: TradesProps) {
  const t = useTheme();
  const s = useStyles();
  const { data, isPending, isError, error, refetch } = usePublicTrades(symbol);
  if (isPending) {
    return (
      <View style={s.skeleton}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={14} style={s.skeletonRow} />
        ))}
      </View>
    );
  }
  if (isError) return <ErrorState compact error={error} onRetry={() => void refetch()} />;
  const list = (data ?? []).slice(0, rows);
  return (
    <View>
      <View style={s.header}>
        <Txt variant="micro" tone="faint" style={s.flex}>
          Price
        </Txt>
        <Txt variant="micro" tone="faint" style={s.flex} align="right">
          Amount
        </Txt>
        <Txt variant="micro" tone="faint" style={s.flex} align="right">
          Time
        </Txt>
      </View>
      {list.length === 0 ? (
        <Txt variant="caption" tone="faint" style={s.emptyTrades}>
          No trades yet
        </Txt>
      ) : (
        list.map((tr) => (
          <View key={tr.id} style={s.row}>
            <Txt
              variant="caption"
              numeric
              weight="medium"
              color={tr.side === 'BUY' ? t.colors.up : t.colors.down}
              style={s.flex}
            >
              {formatPrice(tr.price, tickSize)}
            </Txt>
            <Txt variant="caption" numeric style={s.flex} align="right">
              {formatQty(tr.qty, stepSize)}
            </Txt>
            <Txt variant="caption" numeric tone="muted" style={s.flex} align="right">
              {fmtTime(tr.ts)}
            </Txt>
          </View>
        ))
      )}
    </View>
  );
}

export const RecentTradesView = memo(RecentTradesViewImpl);

const useStyles = makeStyles(() => ({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  columns: {
    flexDirection: 'row',
  },
  gap: {
    width: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    paddingHorizontal: 2,
  },
  depth: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    borderRadius: 2,
  },
  depthRight: {
    right: 0,
  },
  depthLeft: {
    left: 0,
  },
  spread: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  skeleton: {
    paddingVertical: 4,
  },
  skeletonRow: {
    marginBottom: 8,
  },
  emptyTrades: {
    paddingVertical: 16,
    textAlign: 'center',
  },
}));
