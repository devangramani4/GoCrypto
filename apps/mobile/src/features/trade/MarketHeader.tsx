import type { MarketDto, MarketType, TickerDto } from '@gocrypto/shared-types';
import { useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import {
  ChangeText,
  Icon,
  IconButton,
  OptionSheet,
  PriceText,
  Skeleton,
  Stat,
  Txt,
  type OptionItem,
} from '../../components';
import { useAllTickers, useMarkets } from '../../hooks/useMarketData';
import { formatCompact, formatPrice, stripPerp } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { useSettings } from '../../store/settings';
import { makeStyles, useTheme } from '../../theme';

export function marketTitle(m: Pick<MarketDto, 'base' | 'quote' | 'type' | 'symbol'>): string {
  return m.type === 'FUTURES' ? `${stripPerp(m.symbol)} Perp` : `${m.base}/${m.quote}`;
}

interface MarketHeaderProps {
  symbol: string;
  market: MarketDto | undefined;
  ticker: TickerDto | undefined;
  onPressTitle: () => void;
  /** Extra stats row content (futures: mark / funding). */
  extra?: ReactNode;
  right?: ReactNode;
}

/** Pair selector, live last price, 24h change and 24h statistics. */
export function MarketHeader({ symbol, market, ticker, onPressTitle, extra, right }: MarketHeaderProps) {
  const t = useTheme();
  const s = useStyles();
  const favorite = useSettings((st) => st.favorites.includes(symbol));
  const tick = market?.tickSize ?? '0.01';
  return (
    <View style={s.root}>
      <View style={s.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change market"
          onPress={onPressTitle}
          hitSlop={6}
          style={s.title}
        >
          <Txt variant="heading" weight="bold">
            {market ? marketTitle(market) : symbol}
          </Txt>
          <Icon name="chevron-down" size={18} color={t.colors.textMuted} />
        </Pressable>
        <View style={s.actions}>
          {right}
          <IconButton
            icon={favorite ? 'star-filled' : 'star'}
            color={favorite ? t.colors.warn : t.colors.textMuted}
            accessibilityLabel={favorite ? 'Remove from watchlist' : 'Add to watchlist'}
            onPress={() => {
              haptics.light();
              useSettings.getState().toggleFavorite(symbol);
            }}
          />
        </View>
      </View>
      <View style={s.priceRow}>
        {ticker ? (
          <PriceText value={ticker.lastPrice} tickSize={tick} variant="title" colorBy="tick" />
        ) : (
          <Skeleton width={140} height={26} />
        )}
        {ticker ? (
          <ChangeText ratio={ticker.priceChangePercent} variant="label" weight="semibold" style={s.change} />
        ) : null}
      </View>
      <View style={s.stats}>
        <Stat label="24h High" value={ticker ? formatPrice(ticker.high, tick) : undefined} />
        <Stat label="24h Low" value={ticker ? formatPrice(ticker.low, tick) : undefined} />
        <Stat label={`24h Vol (${market?.base ?? ''})`} value={ticker ? formatCompact(ticker.volume) : undefined} />
        <Stat
          label={`24h Vol (${market?.quote ?? ''})`}
          value={ticker ? formatCompact(ticker.quoteVolume) : undefined}
          align="right"
        />
      </View>
      {extra}
    </View>
  );
}

interface MarketPickerProps {
  visible: boolean;
  onClose: () => void;
  type: Extract<MarketType, 'SPOT' | 'FUTURES'>;
  selected: string;
  onSelect: (symbol: string) => void;
}

/** Searchable market list (with live price/change) in a bottom sheet. */
export function MarketPicker({ visible, onClose, type, selected, onSelect }: MarketPickerProps) {
  const markets = useMarkets(type);
  const tickers = useAllTickers({ enabled: visible });

  const items = useMemo<OptionItem<string>[]>(() => {
    const bySymbol = new Map((tickers.data ?? []).map((x) => [x.symbol, x]));
    return (markets.data ?? [])
      .filter((m) => m.status === 'TRADING' || m.status === 'PRE_TRADING' || m.status === 'HALTED')
      .map((m) => {
        const tk = bySymbol.get(m.symbol);
        return {
          value: m.symbol,
          label: marketTitle(m),
          description:
            m.status === 'TRADING'
              ? tk
                ? `Vol ${formatCompact(tk.quoteVolume)} ${m.quote}`
                : m.displayName
              : m.status.replace('_', ' '),
          keywords: `${m.symbol} ${m.base} ${m.displayName}`,
          right: tk ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Txt variant="label" numeric weight="medium">
                {formatPrice(tk.lastPrice, m.tickSize)}
              </Txt>
              <ChangeText ratio={tk.priceChangePercent} variant="micro" />
            </View>
          ) : undefined,
        };
      });
  }, [markets.data, tickers.data]);

  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title={type === 'SPOT' ? 'Spot markets' : 'Perpetual contracts'}
      items={items}
      selected={selected}
      onSelect={onSelect}
      searchable
      searchPlaceholder="Search (e.g. BTC)"
      emptyText={markets.isPending ? 'Loading markets…' : 'No markets found'}
    />
  );
}

const useStyles = makeStyles(() => ({
  root: {
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 2,
  },
  change: {
    marginLeft: 2,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
}));
