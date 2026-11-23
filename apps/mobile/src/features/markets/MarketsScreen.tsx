import type { MarketDto, TickerDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Divider, EmptyState, ErrorState, Icon, SkeletonRows, TabHeader, Tabs, TextField, Txt } from '../../components';
import { Screen } from '../../components/Screen';
import { useRefresh } from '../../hooks/useCommon';
import { useAllTickers, useMarkets } from '../../hooks/useMarketData';
import { useRealtimeStatus } from '../../lib/realtime';
import type { TabScreenProps } from '../../navigation/types';
import { useSettings } from '../../store/settings';
import { makeStyles, useTheme } from '../../theme';
import { MARKET_ROW_HEIGHT, MarketRow } from './MarketRow';

type MarketsTab = 'favorites' | 'SPOT' | 'FUTURES';
type SortKey = 'name' | 'volume' | 'price' | 'change';

interface Row {
  market: MarketDto;
  ticker: TickerDto | undefined;
}

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.market.symbol.localeCompare(b.market.symbol);
    case 'volume':
      return D(a.ticker?.quoteVolume ?? '0').comparedTo(D(b.ticker?.quoteVolume ?? '0'));
    case 'price':
      return D(a.ticker?.lastPrice ?? '0').comparedTo(D(b.ticker?.lastPrice ?? '0'));
    case 'change':
      return D(a.ticker?.priceChangePercent ?? '0').comparedTo(D(b.ticker?.priceChangePercent ?? '0'));
  }
}

/** Live status dot: green when streaming, amber when falling back to polling. */
export function LiveIndicator() {
  const t = useTheme();
  const status = useRealtimeStatus();
  const live = status === 'connected';
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      accessibilityLabel={live ? 'Live prices' : 'Prices delayed'}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: live ? t.colors.up : t.colors.warn }} />
      <Txt variant="micro" tone="muted">
        {live ? 'Live' : status === 'connecting' ? 'Connecting' : 'Delayed'}
      </Txt>
    </View>
  );
}

export function MarketsScreen({ navigation }: TabScreenProps<'Markets'>) {
  const t = useTheme();
  const s = useStyles();
  const [tab, setTab] = useState<MarketsTab>('SPOT');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'volume', dir: -1 });
  const favorites = useSettings((st) => st.favorites);
  const toggleFavorite = useSettings((st) => st.toggleFavorite);
  const spot = useMarkets('SPOT');
  const futures = useMarkets('FUTURES');
  const tickers = useAllTickers();

  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([tickers.refetch(), spot.refetch(), futures.refetch()]),
  );

  const rows = useMemo<Row[]>(() => {
    const bySymbol = new Map((tickers.data ?? []).map((x) => [x.symbol, x]));
    const base =
      tab === 'SPOT'
        ? (spot.data ?? [])
        : tab === 'FUTURES'
          ? (futures.data ?? [])
          : [...(spot.data ?? []), ...(futures.data ?? [])].filter((m) => favorites.includes(m.symbol));
    const q = query.trim().toUpperCase();
    return base
      .filter((m) => m.status !== 'DELISTED' && m.status !== 'SETTLED')
      .filter((m) => !q || m.symbol.includes(q) || m.base.includes(q) || m.displayName.toUpperCase().includes(q))
      .map((market) => ({ market, ticker: bySymbol.get(market.symbol) }))
      .sort((a, b) => compare(a, b, sort.key) * sort.dir);
  }, [tab, spot.data, futures.data, tickers.data, favorites, query, sort]);

  const open = useCallback(
    (m: MarketDto) => {
      if (m.type === 'FUTURES') navigation.navigate('Futures', { symbol: m.symbol });
      else navigation.navigate('Trade', { symbol: m.symbol });
    },
    [navigation],
  );

  const sortBy = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }));

  const sortHeader = (label: string, k: SortKey, align: 'left' | 'right') => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
      onPress={() => sortBy(k)}
      hitSlop={6}
      style={s.sortItem}
    >
      <Txt variant="micro" tone={sort.key === k ? 'default' : 'faint'} align={align}>
        {label}
      </Txt>
      {sort.key === k ? (
        <Icon name={sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size={12} color={t.colors.text} />
      ) : null}
    </Pressable>
  );

  const loading =
    (tab === 'FUTURES' ? futures.isPending : spot.isPending) ||
    (tab === 'favorites' && (spot.isPending || futures.isPending));
  const error = tab === 'FUTURES' ? futures.error : spot.error;

  const header = (
    <View>
      <TabHeader title="Markets" right={<LiveIndicator />} />
      <View style={s.searchWrap}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search coin or pair"
          autoCapitalize="characters"
          autoCorrect={false}
          dense
          returnKeyType="search"
          containerStyle={s.search}
          left={<Icon name="search" size={18} color={t.colors.textMuted} />}
          inputStyle={s.searchInput}
          right={
            query ? (
              <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}>
                <Icon name="close" size={16} color={t.colors.textMuted} />
              </Pressable>
            ) : undefined
          }
        />
        <Tabs
          options={[
            { value: 'favorites', label: 'Favorites' },
            { value: 'SPOT', label: 'Spot' },
            { value: 'FUTURES', label: 'Futures' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <View style={s.sortRow}>
        <View style={s.sortName}>
          {sortHeader('Name', 'name', 'left')}
          <Txt variant="micro" tone="faint">
            {' / '}
          </Txt>
          {sortHeader('Vol', 'volume', 'left')}
        </View>
        {sortHeader('Last price', 'price', 'right')}
        <View style={s.sortChange}>{sortHeader('24h chg', 'change', 'right')}</View>
      </View>
      <Divider />
    </View>
  );

  return (
    <Screen topInset bottomInset={false} scroll={false} padded={false} header={header}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.market.symbol}
        renderItem={({ item }) => (
          <MarketRow
            market={item.market}
            ticker={item.ticker}
            favorite={favorites.includes(item.market.symbol)}
            onPress={open}
            onToggleFavorite={toggleFavorite}
          />
        )}
        getItemLayout={(_d, index) => ({ length: MARKET_ROW_HEIGHT, offset: MARKET_ROW_HEIGHT * index, index })}
        initialNumToRender={14}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.textMuted}
            colors={[t.colors.brand]}
            progressBackgroundColor={t.colors.surface}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={s.pad}>
              <SkeletonRows count={9} />
            </View>
          ) : error ? (
            <ErrorState error={error} onRetry={() => void (tab === 'FUTURES' ? futures.refetch() : spot.refetch())} />
          ) : tab === 'favorites' && !query ? (
            <EmptyState
              icon="star"
              title="No favorites yet"
              message="Tap the star next to a market to add it to your watchlist."
            />
          ) : (
            <EmptyState
              icon="search"
              title="No markets found"
              message={query ? `Nothing matches “${query}”.` : undefined}
            />
          )
        }
        contentContainerStyle={s.list}
      />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  searchWrap: {
    paddingHorizontal: 16,
  },
  search: {
    marginBottom: 8,
  },
  searchInput: {
    marginLeft: 8,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sortName: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sortChange: {
    width: 78,
    marginLeft: 10,
    alignItems: 'flex-end',
  },
  list: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  pad: {
    paddingHorizontal: 16,
  },
}));
