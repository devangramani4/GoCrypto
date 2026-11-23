import type {
  CandleDto,
  MarketDto,
  MarketType,
  MarkPriceDto,
  OrderBookDto,
  PublicTradeDto,
  TickerDto,
  Timeframe,
  WsEnvelope,
} from '@gocrypto/shared-types';
import { ALL_TICKERS_CHANNEL, marketChannel, userChannel } from '@gocrypto/shared-types';
import { useToast } from '@gocrypto/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../stores/session';
import { api, realtime } from './api';

export function useMarkets(type?: MarketType) {
  return useQuery({ queryKey: ['markets', type ?? 'all'], queryFn: () => api.markets.list(type), staleTime: 60_000 });
}

export function useMarket(symbol: string): MarketDto | undefined {
  const { data } = useMarkets();
  return useMemo(() => data?.find((m) => m.symbol === symbol), [data, symbol]);
}

export function useAssets() {
  return useQuery({ queryKey: ['assets'], queryFn: () => api.assets.list(), staleTime: 30_000 });
}

/** All tickers: REST snapshot + live updates from the all-tickers channel. */
export function useTickers(type?: MarketType) {
  const qc = useQueryClient();
  const key = ['tickers', type ?? 'all'];
  const query = useQuery({ queryKey: key, queryFn: () => api.markets.tickers(type), refetchInterval: 30_000 });
  useEffect(
    () =>
      realtime.subscribe<'tickers'>(ALL_TICKERS_CHANNEL, (e) => {
        qc.setQueryData<TickerDto[]>(key, (prev) => {
          const incoming = e.data.filter((t) => !type || t.type === type);
          if (!prev) return incoming;
          const map = new Map(prev.map((t) => [t.symbol, t]));
          for (const t of incoming) map.set(t.symbol, t);
          return [...map.values()];
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type],
  );
  return query;
}

function useLive<T, E extends 'ticker' | 'orderbook' | 'mark'>(symbol: string, kind: E, fetcher: () => Promise<T>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!symbol || !enabled) return;
    let active = true;
    setData(null);
    setError(null);
    fetcher()
      .then((d) => active && setData((cur) => cur ?? d))
      .catch((e) => active && setError(e));
    const off = realtime.subscribe(marketChannel(symbol, kind), (e: WsEnvelope) => active && setData(e.data as T));
    return () => {
      active = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, kind, enabled]);
  return { data, error, loading: !data && !error };
}

export function useTicker(symbol: string) {
  return useLive<TickerDto, 'ticker'>(symbol, 'ticker', () => api.markets.ticker(symbol));
}

export function useOrderBook(symbol: string) {
  return useLive<OrderBookDto, 'orderbook'>(symbol, 'orderbook', () => api.markets.orderBook(symbol, 100));
}

export function useMarkPrice(symbol: string, enabled = true) {
  return useLive<MarkPriceDto, 'mark'>(symbol, 'mark', () => api.markets.mark(symbol), enabled);
}

export function useRecentTrades(symbol: string, limit = 60) {
  const [trades, setTrades] = useState<PublicTradeDto[] | null>(null);
  useEffect(() => {
    let active = true;
    setTrades(null);
    api.markets
      .trades(symbol, limit)
      .then((t) => active && setTrades((cur) => cur ?? t))
      .catch(() => active && setTrades([]));
    const off = realtime.subscribe<'trades'>(marketChannel(symbol, 'trades'), (e) => {
      if (!active) return;
      setTrades((cur) => [...[...e.data].reverse(), ...(cur ?? [])].slice(0, limit));
    });
    return () => {
      active = false;
      off();
    };
  }, [symbol, limit]);
  return trades;
}

/** Historical candles + live updates of the forming candle. */
export function useCandles(symbol: string, interval: Timeframe) {
  const [candles, setCandles] = useState<CandleDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const version = useRef(0);
  useEffect(() => {
    let active = true;
    setCandles(null);
    setError(null);
    api.markets
      .candles(symbol, interval, { limit: 1000 })
      .then((c) => active && setCandles(c))
      .catch((e) => active && setError(e));
    const off = realtime.subscribe<'candle'>(marketChannel(symbol, `candles:${interval}`), (e) => {
      if (!active) return;
      const c = e.data.candle;
      setCandles((cur) => {
        if (!cur) return cur;
        const last = cur[cur.length - 1];
        if (last && last.t === c.t) return [...cur.slice(0, -1), c];
        if (!last || c.t > last.t) return [...cur, c].slice(-1500);
        return cur;
      });
      version.current += 1;
    });
    return () => {
      active = false;
      off();
    };
  }, [symbol, interval]);
  return { candles, error, loading: !candles && !error };
}

/**
 * Private user stream: keeps orders, balances, positions and notifications fresh across the app
 * by invalidating React Query caches when the server pushes changes.
 */
export function useUserStream(): void {
  const user = useSession((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (!user) return;
    const offs = [
      realtime.subscribe<'order'>(userChannel(user.id, 'orders'), (e) => {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        if (e.data.status === 'FILLED') toast.success(`${e.data.side === 'BUY' ? 'Buy' : 'Sell'} ${e.data.symbol} filled`, `${e.data.filledQuantity} @ ${e.data.avgPrice ?? '-'}`);
        if (e.data.status === 'REJECTED' || (e.data.status === 'EXPIRED' && e.data.rejectReason)) {
          toast.error(`${e.data.symbol} order ${e.data.status.toLowerCase()}`, e.data.rejectReason ?? undefined);
        }
      }),
      realtime.subscribe(userChannel(user.id, 'balance'), () => {
        void qc.invalidateQueries({ queryKey: ['balances'] });
        void qc.invalidateQueries({ queryKey: ['portfolio'] });
        void qc.invalidateQueries({ queryKey: ['futures-account'] });
        void qc.invalidateQueries({ queryKey: ['options-account'] });
      }),
      realtime.subscribe(userChannel(user.id, 'positions'), () => {
        void qc.invalidateQueries({ queryKey: ['positions'] });
        void qc.invalidateQueries({ queryKey: ['futures-account'] });
      }),
      realtime.subscribe(userChannel(user.id, 'trades'), () => void qc.invalidateQueries({ queryKey: ['fills'] })),
      realtime.subscribe<'notification'>(userChannel(user.id, 'notifications'), (e) => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        if (!['ORDER_FILLED', 'ORDER_PARTIALLY_FILLED'].includes(e.data.type)) toast.info(e.data.title, e.data.body);
        window.gocryptoDesktop?.notify(e.data.title, e.data.body);
      }),
      realtime.subscribe<'liquidation'>(userChannel(user.id, 'liquidations'), (e) => {
        toast.error(`${e.data.symbol} position liquidated`, `${e.data.quantity} @ ${e.data.markPrice}`);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [user, qc, toast]);
}

/** Previous value of a changing number to drive up/down flash animations. */
export function useDirection(value: string | null | undefined): 'up' | 'down' | null {
  const prev = useRef<string | null | undefined>(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (value && prev.current && value !== prev.current) setDir(Number(value) >= Number(prev.current) ? 'up' : 'down');
    prev.current = value;
  }, [value]);
  return dir;
}

// ───────────────────────── private account queries ─────────────────────────
// Query keys are prefixes the user stream invalidates (['balances'], ['orders'], ['positions'] …).

export function useAuthed(): boolean {
  return useSession((s) => s.status === 'authenticated');
}

export function useBalances(account: 'SPOT' | 'FUTURES' | 'OPTIONS') {
  const authed = useAuthed();
  return useQuery({ queryKey: ['balances', account], queryFn: () => api.wallet.balances(account, true), enabled: authed });
}

/** Available balance of one asset in one account (decimal string, "0" when unknown). */
export function useAvailable(account: 'SPOT' | 'FUTURES' | 'OPTIONS', asset: string): string {
  const { data } = useBalances(account);
  return useMemo(() => data?.find((b) => b.asset === asset)?.available ?? '0', [data, asset]);
}

export function useFuturesAccount() {
  const authed = useAuthed();
  return useQuery({ queryKey: ['futures-account'], queryFn: () => api.futures.account(), enabled: authed });
}

export function useFuturesPositions() {
  const authed = useAuthed();
  return useQuery({ queryKey: ['positions', 'futures'], queryFn: () => api.futures.positions(), enabled: authed });
}

export function useOpenOrders(marketType: MarketType) {
  const authed = useAuthed();
  return useQuery({ queryKey: ['orders', 'open', marketType], queryFn: () => api.orders.open({ marketType }), enabled: authed });
}

export function useUnreadCount() {
  const authed = useAuthed();
  return useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.notifications.unreadCount(), enabled: authed, refetchInterval: 60_000 });
}

/** Live mark prices for a set of symbols (positions tables), seeded with REST values. */
export function useLiveMarks(symbols: string[], seed: Record<string, string> = {}): Record<string, string> {
  const [marks, setMarks] = useState<Record<string, string>>(seed);
  const key = [...new Set(symbols)].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const offs = key.split(',').map((s) =>
      realtime.subscribe<'mark'>(marketChannel(s, 'mark'), (e) => setMarks((m) => (m[s] === e.data.markPrice ? m : { ...m, [s]: e.data.markPrice }))),
    );
    return () => offs.forEach((off) => off());
  }, [key]);
  return marks;
}

/** Futures markets keyed by symbol (formatting precision, risk tiers). */
export function useMarketMap(type?: MarketType): Map<string, MarketDto> {
  const { data } = useMarkets(type);
  return useMemo(() => new Map((data ?? []).map((m) => [m.symbol, m])), [data]);
}

/** Public platform status (sandbox flag, server clock). */
export function useSystemStatus() {
  return useQuery({ queryKey: ['system-status'], queryFn: () => api.system.status(), staleTime: 5 * 60_000, retry: 1 });
}
