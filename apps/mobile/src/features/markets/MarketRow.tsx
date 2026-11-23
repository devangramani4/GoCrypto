import type { MarketDto, TickerDto } from '@gocrypto/shared-types';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { AssetIcon, Badge, Icon, PriceText, Txt } from '../../components';
import { formatCompact, formatPercent, signOf } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { makeStyles, useTheme } from '../../theme';
import { marketTitle } from '../trade/MarketHeader';

export const MARKET_ROW_HEIGHT = 64;

interface MarketRowProps {
  market: MarketDto;
  ticker: TickerDto | undefined;
  favorite?: boolean;
  onPress: (market: MarketDto) => void;
  onToggleFavorite?: (symbol: string) => void;
}

/** One market line: pair, 24h volume, live last price and a colored 24h change pill. */
function MarketRowImpl({ market, ticker, favorite, onPress, onToggleFavorite }: MarketRowProps) {
  const t = useTheme();
  const s = useStyles();
  const sign = signOf(ticker?.priceChangePercent);
  const pillBg = sign > 0 ? t.colors.up : sign < 0 ? t.colors.down : t.colors.raised;
  const pillFg = sign === 0 ? t.colors.textMuted : t.colors.onTrade;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${marketTitle(market)}, ${ticker ? `last price ${ticker.lastPrice}, ${formatPercent(ticker.priceChangePercent)}` : 'no price yet'}`}
      onPress={() => onPress(market)}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.colors.hover }]}
    >
      {onToggleFavorite ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={favorite ? 'Remove from watchlist' : 'Add to watchlist'}
          hitSlop={10}
          onPress={() => {
            haptics.light();
            onToggleFavorite(market.symbol);
          }}
          style={s.star}
        >
          <Icon
            name={favorite ? 'star-filled' : 'star'}
            size={16}
            color={favorite ? t.colors.warn : t.colors.textFaint}
          />
        </Pressable>
      ) : null}
      <AssetIcon symbol={market.base} size={32} />
      <View style={s.name}>
        <View style={s.nameRow}>
          <Txt variant="body" weight="semibold" numberOfLines={1}>
            {market.type === 'FUTURES' ? marketTitle(market) : market.base}
            {market.type === 'SPOT' ? (
              <Txt variant="caption" tone="faint">
                {' '}
                /{market.quote}
              </Txt>
            ) : null}
          </Txt>
          {market.status !== 'TRADING' ? <Badge label={market.status.replace('_', ' ')} tone="warn" /> : null}
        </View>
        <Txt variant="caption" tone="faint" numeric numberOfLines={1}>
          {ticker ? `Vol ${formatCompact(ticker.quoteVolume)}` : '—'}
        </Txt>
      </View>
      <View style={s.price}>
        {ticker ? (
          <PriceText
            value={ticker.lastPrice}
            tickSize={market.tickSize}
            variant="body"
            weight="semibold"
            colorBy="tick"
            align="right"
          />
        ) : (
          <Txt variant="body" tone="faint">
            —
          </Txt>
        )}
      </View>
      <View style={[s.pill, { backgroundColor: pillBg }]}>
        <Txt variant="label" weight="semibold" numeric color={pillFg}>
          {ticker ? formatPercent(ticker.priceChangePercent) : '—'}
        </Txt>
      </View>
    </Pressable>
  );
}

export const MarketRow = memo(MarketRowImpl);

const useStyles = makeStyles((t) => ({
  row: {
    height: MARKET_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  star: {
    marginRight: -2,
  },
  name: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  price: {
    alignItems: 'flex-end',
    minWidth: 88,
  },
  pill: {
    minWidth: 78,
    height: 32,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
}));
