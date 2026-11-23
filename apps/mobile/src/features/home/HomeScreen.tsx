import type { MarketDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import {
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Notice,
  PnLText,
  Screen,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  SkeletonRows,
  Txt,
  type IconName,
} from '../../components';
import { config } from '../../config';
import { useRefresh, useUnreadCount } from '../../hooks/useCommon';
import { useAllTickers, useMarkets } from '../../hooks/useMarketData';
import { api } from '../../lib/api';
import { formatUsd } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { TabScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { makeStyles, useTheme } from '../../theme';
import { MarketRow } from '../markets/MarketRow';
import { LiveIndicator } from '../markets/MarketsScreen';

const HIDDEN = '••••••';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const t = useTheme();
  const s = useStyles();
  const focused = useIsFocused();
  const user = useSession((st) => st.user);
  const hide = useSettings((st) => st.hideBalances);
  const favorites = useSettings((st) => st.favorites);
  const toggleFavorite = useSettings((st) => st.toggleFavorite);
  const [movers, setMovers] = useState<'gainers' | 'losers'>('gainers');

  const summary = useQuery({
    queryKey: qk.portfolioSummary,
    queryFn: () => api.portfolio.summary(),
    refetchInterval: focused ? 15_000 : false,
  });
  const unread = useUnreadCount();
  const tickers = useAllTickers();
  const spot = useMarkets('SPOT');
  const futures = useMarkets('FUTURES');

  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([summary.refetch(), unread.refetch(), tickers.refetch()]),
  );

  const markets = useMemo(
    () => new Map([...(spot.data ?? []), ...(futures.data ?? [])].map((m) => [m.symbol, m])),
    [spot.data, futures.data],
  );
  const bySymbol = useMemo(() => new Map((tickers.data ?? []).map((x) => [x.symbol, x])), [tickers.data]);

  const watchlist = useMemo(
    () =>
      favorites
        .map((sym) => markets.get(sym))
        .filter((m): m is MarketDto => Boolean(m))
        .slice(0, 6),
    [favorites, markets],
  );

  const topMovers = useMemo(() => {
    const list = (tickers.data ?? []).filter((x) => markets.get(x.symbol)?.status === 'TRADING');
    const sorted = list.sort((a, b) => D(b.priceChangePercent).comparedTo(D(a.priceChangePercent)));
    return (movers === 'gainers' ? sorted : sorted.reverse()).slice(0, 5);
  }, [tickers.data, markets, movers]);

  const openMarket = useCallback(
    (m: MarketDto) => {
      if (m.type === 'FUTURES') navigation.navigate('Futures', { symbol: m.symbol });
      else navigation.navigate('Trade', { symbol: m.symbol });
    },
    [navigation],
  );

  const name = user?.displayName ?? user?.email.split('@')[0] ?? 'Trader';
  const initials = name.slice(0, 2).toUpperCase();
  const p = summary.data;
  const money = (v: string | undefined) => (hide ? HIDDEN : formatUsd(v));

  const actions: { icon: IconName; label: string; onPress: () => void }[] = [
    { icon: 'deposit', label: 'Deposit', onPress: () => navigation.navigate('Deposit') },
    { icon: 'withdraw', label: 'Withdraw', onPress: () => navigation.navigate('Withdraw') },
    { icon: 'transfer', label: 'Transfer', onPress: () => navigation.navigate('Transfer') },
    { icon: 'trade', label: 'Trade', onPress: () => navigation.navigate('Trade') },
  ];

  const header = (
    <View style={s.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={() => navigation.navigate('Profile')}
        style={s.avatar}
      >
        <Txt variant="label" weight="bold" color={t.colors.brand}>
          {initials}
        </Txt>
      </Pressable>
      <View style={s.headerText}>
        <Txt variant="caption" tone="muted">
          {greeting()}
        </Txt>
        <Txt variant="subtitle" numberOfLines={1}>
          {name}
        </Txt>
      </View>
      <LiveIndicator />
      <IconButton
        icon="bell"
        badge={unread.data ?? 0}
        onPress={() => navigation.navigate('Notifications')}
        accessibilityLabel="Notifications"
      />
    </View>
  );

  return (
    <Screen topInset bottomInset={false} header={header} refreshing={refreshing} onRefresh={onRefresh}>
      <Card style={s.portfolio}>
        <View style={s.portfolioHead}>
          <Txt variant="label" tone="muted">
            Total portfolio value
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hide ? 'Show balances' : 'Hide balances'}
            hitSlop={10}
            onPress={() => {
              haptics.selection();
              useSettings.getState().toggleHideBalances();
            }}
          >
            <Icon name={hide ? 'eye-off' : 'eye'} size={18} color={t.colors.textMuted} />
          </Pressable>
        </View>
        {p ? (
          <>
            <Txt variant="display" numeric numberOfLines={1} adjustsFontSizeToFit>
              {money(p.totalValue)}
            </Txt>
            <View style={s.today}>
              <Txt variant="caption" tone="muted">
                Today's P&L{' '}
              </Txt>
              {hide ? (
                <Txt variant="label">{HIDDEN}</Txt>
              ) : (
                <PnLText value={p.todayPnl} ratio={p.todayPnlPercent} usd variant="label" weight="semibold" />
              )}
            </View>
            <View style={s.split}>
              <Split label="Spot" value={money(p.spotValue)} />
              <Split label="Futures" value={money(p.futuresValue)} />
              <Split label="Options" value={money(p.optionsValue)} />
            </View>
          </>
        ) : summary.isError ? (
          <ErrorState compact error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <>
            <Skeleton width={200} height={36} />
            <Skeleton width={140} height={14} style={s.skeletonGap} />
          </>
        )}
      </Card>

      {p ? (
        <View style={s.grid}>
          <StatTile label="Available balance" value={money(p.availableBalance)} />
          <StatTile label="Used margin" value={money(p.usedMargin)} />
          <StatTile label="Unrealized P&L">
            {hide ? <Txt variant="subtitle">{HIDDEN}</Txt> : <PnLText value={p.unrealizedPnl} usd variant="subtitle" />}
          </StatTile>
          <StatTile label="Open orders · positions" value={`${p.openOrders} · ${p.openPositions}`} />
        </View>
      ) : null}

      <View style={s.actions}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={() => {
              haptics.light();
              a.onPress();
            }}
            style={({ pressed }) => [s.action, pressed && s.pressed]}
          >
            <View style={s.actionIcon}>
              <Icon name={a.icon} size={22} color={t.colors.brand} />
            </View>
            <Txt variant="caption" weight="medium">
              {a.label}
            </Txt>
          </Pressable>
        ))}
      </View>

      {watchlist.length ? (
        <>
          <SectionHeader
            title="Watchlist"
            action="All markets"
            onAction={() => navigation.navigate('Markets')}
            style={s.section}
          />
          <Card padded={false}>
            {watchlist.map((m) => (
              <MarketRow
                key={m.symbol}
                market={m}
                ticker={bySymbol.get(m.symbol)}
                favorite
                onPress={openMarket}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Top movers" style={s.section} />
      <SegmentedControl
        size="sm"
        options={[
          { value: 'gainers', label: 'Gainers' },
          { value: 'losers', label: 'Losers' },
        ]}
        value={movers}
        onChange={setMovers}
        style={s.moversSwitch}
      />
      <Card padded={false}>
        {tickers.isPending || (spot.isPending && futures.isPending) ? (
          <View style={s.pad}>
            <SkeletonRows count={5} />
          </View>
        ) : tickers.isError ? (
          <ErrorState compact error={tickers.error} onRetry={() => void tickers.refetch()} />
        ) : topMovers.length === 0 ? (
          <EmptyState compact icon="markets" title="No market data yet" />
        ) : (
          topMovers.map((x) => {
            const m = markets.get(x.symbol);
            return m ? <MarketRow key={x.symbol} market={m} ticker={x} onPress={openMarket} /> : null;
          })
        )}
      </Card>

      {config.sandbox ? (
        <Notice
          tone="info"
          title="Sandbox environment"
          message="All balances are paper money. Use Deposit → Simulate deposit to add test funds."
          style={s.section}
        />
      ) : null}
    </Screen>
  );
}

function Split({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="micro" tone="faint">
        {label}
      </Txt>
      <Txt variant="label" weight="medium" numeric numberOfLines={1}>
        {value}
      </Txt>
    </View>
  );
}

function StatTile({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  const s = useStyles();
  return (
    <Card style={s.tile}>
      <Txt variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Txt>
      <View style={s.tileValue}>
        {children ?? (
          <Txt variant="subtitle" numeric numberOfLines={1} adjustsFontSizeToFit>
            {value}
          </Txt>
        )}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  portfolio: {
    marginTop: 6,
    padding: 18,
  },
  portfolioHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  today: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  split: {
    flexDirection: 'row',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: t.hairline,
    borderTopColor: t.colors.border,
    gap: 8,
  },
  skeletonGap: {
    marginTop: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
  },
  tileValue: {
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  action: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  actionIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginTop: 22,
  },
  moversSwitch: {
    marginBottom: 10,
  },
  pad: {
    paddingHorizontal: 16,
  },
}));
