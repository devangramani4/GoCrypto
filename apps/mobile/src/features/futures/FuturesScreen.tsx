import { isPerpSymbol } from '@gocrypto/trading-utils';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, PnLText, Screen, Skeleton, Stat, Txt } from '../../components';
import { useNow, useRefresh } from '../../hooks/useCommon';
import { useMarket, useMarkPrice, useTicker } from '../../hooks/useMarketData';
import { api } from '../../lib/api';
import { fmtCountdown, formatNumber, formatPercent, formatPrice } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import type { TabScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { makeStyles, useTheme } from '../../theme';
import { CandleChart } from '../trade/CandleChart';
import { MarketHeader, MarketPicker } from '../trade/MarketHeader';
import { OrdersPanel } from '../trade/OrdersPanel';
import { FuturesOrderForm } from './FuturesOrderForm';
import { LeverageSheet, MarginModeSheet } from './LeverageSheet';
import { PositionsCard } from './Positions';

function FundingCountdown({ next }: { next: number | undefined }) {
  const now = useNow(1000);
  return (
    <Txt variant="label" weight="semibold" numeric style={{ marginTop: 2 }}>
      {next ? fmtCountdown(next, now) : '—'}
    </Txt>
  );
}

export function FuturesScreen({ navigation, route }: TabScreenProps<'Futures'>) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const lastFutures = useSettings((st) => st.lastFuturesSymbol);
  const requested = route.params?.symbol;
  const symbol = requested && isPerpSymbol(requested) ? requested : lastFutures;
  const tradingEnabled = useSession((st) => st.user?.tradingEnabled ?? true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [leverageOpen, setLeverageOpen] = useState(false);
  const [marginOpen, setMarginOpen] = useState(false);
  const [showChart, setShowChart] = useState(true);

  useEffect(() => {
    if (requested && !isPerpSymbol(requested)) navigation.navigate('Trade', { symbol: requested });
  }, [requested, navigation]);

  useEffect(() => {
    if (symbol !== lastFutures) useSettings.getState().setLastFuturesSymbol(symbol);
  }, [symbol, lastFutures]);

  const market = useMarket(symbol);
  const ticker = useTicker(symbol);
  const mark = useMarkPrice(symbol);
  const m = market.data;

  const account = useQuery({
    queryKey: qk.futuresAccount,
    queryFn: () => api.futures.account(),
    refetchInterval: focused ? 10_000 : false,
  });
  // uPnL moves with the mark price: poll while visible (fills/funding also push realtime updates).
  const positions = useQuery({
    queryKey: qk.positions,
    queryFn: () => api.futures.positions(),
    refetchInterval: focused ? 5_000 : false,
  });
  const settings = useQuery({
    queryKey: qk.futuresSettings(symbol),
    queryFn: () => api.futures.settings(symbol),
  });

  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.ticker(symbol) }),
      qc.invalidateQueries({ queryKey: qk.mark(symbol) }),
      qc.invalidateQueries({ queryKey: ['candles', symbol] }),
      qc.invalidateQueries({ queryKey: qk.futures }),
      qc.invalidateQueries({ queryKey: qk.orders }),
    ]),
  );

  const leverage = settings.data?.leverage ?? m?.futures?.defaultLeverage ?? 10;
  const maxLeverage = settings.data?.maxLeverage ?? m?.futures?.maxLeverage ?? 20;
  const marginMode = settings.data?.marginMode ?? 'CROSS';
  const settle = m?.futures?.settleAsset ?? 'USDT';
  const tick = m?.tickSize ?? '0.01';
  const funding = mark.data?.fundingRate ?? ticker.data?.fundingRate;

  const markRow = (
    <View style={s.markRow}>
      <Stat label="Mark" value={mark.data ? formatPrice(mark.data.markPrice, tick) : undefined} />
      <Stat label="Index" value={mark.data ? formatPrice(mark.data.indexPrice, tick) : undefined} />
      <Stat label="Funding">
        <Txt
          variant="label"
          weight="semibold"
          numeric
          style={s.statValue}
          color={funding ? (funding.startsWith('-') ? t.colors.down : t.colors.up) : undefined}
        >
          {funding ? formatPercent(funding, 4) : '—'}
        </Txt>
      </Stat>
      <Stat label="Next funding" align="right">
        <FundingCountdown next={mark.data?.nextFundingTime ?? ticker.data?.nextFundingTime} />
      </Stat>
    </View>
  );

  const header = (
    <MarketHeader
      symbol={symbol}
      market={m}
      ticker={ticker.data}
      onPressTitle={() => setPickerOpen(true)}
      extra={markRow}
    />
  );

  const a = account.data;

  return (
    <Screen topInset bottomInset={false} header={header} refreshing={refreshing} onRefresh={onRefresh}>
      <Card style={s.block}>
        <View style={s.accountHead}>
          <Txt variant="label" tone="muted">
            Futures account ({settle})
          </Txt>
          <Button
            title={showChart ? 'Hide chart' : 'Show chart'}
            size="sm"
            variant="ghost"
            onPress={() => setShowChart((v) => !v)}
          />
        </View>
        {a ? (
          <View style={s.accountRow}>
            <Stat label="Margin balance" value={formatNumber(a.marginBalance, 2)} />
            <Stat label="Available" value={formatNumber(a.availableBalance, 2)} />
            <Stat label="Unrealized PnL" align="right">
              <PnLText value={a.unrealizedPnl} variant="label" weight="semibold" style={s.statValue} />
            </Stat>
          </View>
        ) : account.isError ? (
          <ErrorState compact error={account.error} onRetry={() => void account.refetch()} />
        ) : (
          <Skeleton height={34} />
        )}
      </Card>

      {market.isError ? (
        <>
          <ErrorState error={market.error} title="Contract unavailable" onRetry={() => void market.refetch()} />
          <Button title="Choose another contract" variant="secondary" onPress={() => setPickerOpen(true)} />
        </>
      ) : null}
      {!m && market.isPending ? <Skeleton height={300} radius={14} style={s.block} /> : null}

      {m ? (
        <>
          {showChart ? (
            <Card style={s.block}>
              <CandleChart symbol={m.symbol} tickSize={m.tickSize} height={240} />
            </Card>
          ) : null}
          <View style={s.block}>
            <FuturesOrderForm
              market={m}
              lastPrice={ticker.data?.lastPrice ?? mark.data?.markPrice}
              leverage={leverage}
              marginMode={marginMode}
              availableBalance={a?.availableBalance ?? '0'}
              tradingEnabled={tradingEnabled}
              onPressLeverage={() => setLeverageOpen(true)}
              onPressMarginMode={() => setMarginOpen(true)}
            />
          </View>
          <PositionsCard
            positions={positions.data}
            isPending={positions.isPending}
            error={positions.isError ? positions.error : null}
            onRetry={() => void positions.refetch()}
          />
          <OrdersPanel marketType="FUTURES" symbol={m.symbol} tickSize={m.tickSize} stepSize={m.stepSize} />
        </>
      ) : null}

      <MarketPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="FUTURES"
        selected={symbol}
        onSelect={(next) => navigation.setParams({ symbol: next })}
      />
      <LeverageSheet
        visible={leverageOpen}
        onClose={() => setLeverageOpen(false)}
        symbol={symbol}
        current={leverage}
        max={maxLeverage}
      />
      <MarginModeSheet visible={marginOpen} onClose={() => setMarginOpen(false)} symbol={symbol} current={marginMode} />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  block: {
    marginTop: 12,
  },
  markRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  statValue: {
    marginTop: 2,
  },
  accountHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  accountRow: {
    flexDirection: 'row',
    gap: 8,
  },
}));
