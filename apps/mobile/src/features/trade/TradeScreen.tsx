import { isPerpSymbol } from '@gocrypto/trading-utils';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Screen, Skeleton, Tabs } from '../../components';
import { useRefresh } from '../../hooks/useCommon';
import { useMarket, useTicker } from '../../hooks/useMarketData';
import { qk } from '../../lib/queryKeys';
import type { TabScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { makeStyles } from '../../theme';
import { CandleChart } from './CandleChart';
import { MarketHeader, MarketPicker } from './MarketHeader';
import { OrderBookView, RecentTradesView } from './OrderBookView';
import { OrdersPanel } from './OrdersPanel';
import { SpotOrderForm } from './SpotOrderForm';

export function TradeScreen({ navigation, route }: TabScreenProps<'Trade'>) {
  const s = useStyles();
  const qc = useQueryClient();
  const lastSpot = useSettings((st) => st.lastSpotSymbol);
  const requested = route.params?.symbol;
  const symbol = requested && !isPerpSymbol(requested) ? requested : lastSpot;
  const tradingEnabled = useSession((st) => st.user?.tradingEnabled ?? true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [panel, setPanel] = useState<'book' | 'trades'>('book');
  const [picked, setPicked] = useState<{ price: string; nonce: number } | null>(null);

  // Perpetual symbols belong to the Futures tab.
  useEffect(() => {
    if (requested && isPerpSymbol(requested)) navigation.navigate('Futures', { symbol: requested });
  }, [requested, navigation]);

  useEffect(() => {
    if (symbol !== lastSpot) useSettings.getState().setLastSpotSymbol(symbol);
  }, [symbol, lastSpot]);

  const market = useMarket(symbol);
  const ticker = useTicker(symbol);
  const m = market.data;

  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.ticker(symbol) }),
      qc.invalidateQueries({ queryKey: ['candles', symbol] }),
      qc.invalidateQueries({ queryKey: qk.orderBook(symbol) }),
      qc.invalidateQueries({ queryKey: qk.publicTrades(symbol) }),
      qc.invalidateQueries({ queryKey: qk.orders }),
      qc.invalidateQueries({ queryKey: qk.balances('SPOT') }),
    ]),
  );

  const selectSymbol = (next: string) => {
    setPicked(null);
    navigation.setParams({ symbol: next });
  };

  const header = (
    <MarketHeader symbol={symbol} market={m} ticker={ticker.data} onPressTitle={() => setPickerOpen(true)} />
  );

  return (
    <Screen topInset bottomInset={false} header={header} refreshing={refreshing} onRefresh={onRefresh}>
      {market.isError ? (
        <ErrorState
          error={market.error}
          title="Market unavailable"
          onRetry={() => void market.refetch()}
          style={s.error}
        />
      ) : null}
      {market.isError ? (
        <Button title="Choose another market" variant="secondary" onPress={() => setPickerOpen(true)} />
      ) : null}

      {!m && market.isPending ? (
        <View>
          <Skeleton height={300} radius={14} style={s.block} />
          <Skeleton height={220} radius={14} style={s.block} />
          <Skeleton height={360} radius={14} style={s.block} />
        </View>
      ) : null}

      {m ? (
        <>
          <Card style={s.block}>
            <CandleChart symbol={m.symbol} tickSize={m.tickSize} />
          </Card>
          <Card style={s.block}>
            <Tabs
              options={[
                { value: 'book', label: 'Order book' },
                { value: 'trades', label: 'Market trades' },
              ]}
              value={panel}
              onChange={setPanel}
              style={s.panelTabs}
            />
            {panel === 'book' ? (
              <OrderBookView
                symbol={m.symbol}
                tickSize={m.tickSize}
                stepSize={m.stepSize}
                onPickPrice={(price) => setPicked({ price, nonce: Date.now() })}
              />
            ) : (
              <RecentTradesView symbol={m.symbol} tickSize={m.tickSize} stepSize={m.stepSize} />
            )}
          </Card>
          <View style={s.block}>
            <SpotOrderForm
              market={m}
              lastPrice={ticker.data?.lastPrice}
              picked={picked}
              tradingEnabled={tradingEnabled}
            />
          </View>
          <OrdersPanel marketType="SPOT" symbol={m.symbol} tickSize={m.tickSize} stepSize={m.stepSize} />
        </>
      ) : null}

      <MarketPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        type="SPOT"
        selected={symbol}
        onSelect={selectSymbol}
      />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  block: {
    marginTop: 12,
  },
  panelTabs: {
    marginBottom: 10,
  },
  error: {
    paddingVertical: 32,
  },
}));
