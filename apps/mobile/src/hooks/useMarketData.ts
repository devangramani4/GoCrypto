import type {
  CandleDto,
  MarketDto,
  MarketType,
  MarkPriceDto,
  OrderBookDto,
  PublicTradeDto,
  TickerDto,
  Timeframe,
} from '@gocrypto/shared-types';
import { ALL_TICKERS_CHANNEL, marketChannel } from '@gocrypto/shared-types';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { errorCode } from '../lib/errors';
import { qk } from '../lib/queryKeys';
import { useChannel, useRealtimeStatus } from '../lib/realtime';

const FIVE_MIN = 5 * 60_000;

/**
 * Heavy streams (depth, trades, candles) are only subscribed while their screen is focused; when the
 * screen regains focus the snapshot is re-fetched so nothing missed in the background is lost.
 */
function useRefetchOnRefocus(focused: boolean, refetch: () => unknown): void {
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current) void refetch();
    wasFocused.current = focused;
  }, [focused, refetch]);
}

/** REST polling fallback while the socket is down — only for the focused screen. */
function pollEvery(ms: number, connected: boolean, focused: boolean): number | false {
  return connected || !focused ? false : ms;
}

/** Exchange markets (metadata rarely changes). */
export function useMarkets(type?: MarketType) {
  return useQuery({
    queryKey: qk.markets(type),
    queryFn: () => api.markets.list(type),
    staleTime: FIVE_MIN,
  });
}

/** One market's metadata (tick/step sizes, filters, futures contract info). */
export function useMarket(symbol: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.market(symbol ?? ''),
    queryFn: () => api.markets.get(symbol ?? ''),
    enabled: Boolean(symbol),
    staleTime: FIVE_MIN,
    initialData: () => {
      for (const type of [undefined, 'SPOT', 'FUTURES'] as const) {
        const found = qc.getQueryData<MarketDto[]>(qk.markets(type))?.find((m) => m.symbol === symbol);
        if (found) return found;
      }
      return undefined;
    },
  });
}

function sameTicker(a: TickerDto, b: TickerDto): boolean {
  return (
    a.lastPrice === b.lastPrice &&
    a.priceChangePercent === b.priceChangePercent &&
    a.quoteVolume === b.quoteVolume &&
    a.high === b.high &&
    a.low === b.low &&
    a.markPrice === b.markPrice &&
    a.fundingRate === b.fundingRate
  );
}

/** Merge by symbol, keeping unchanged ticker objects so memoized rows don't re-render. */
function mergeTickers(old: TickerDto[] | undefined, incoming: TickerDto[]): TickerDto[] {
  if (!old) return incoming;
  const next = new Map(old.map((t) => [t.symbol, t]));
  let changed = false;
  for (const t of incoming) {
    const prev = next.get(t.symbol);
    if (prev && sameTicker(prev, t)) continue;
    next.set(t.symbol, t);
    changed = true;
  }
  return changed ? [...next.values()] : old;
}

/**
 * Spot + futures tickers, kept live by the `market:all:tickers` channel. Falls back to polling
 * while the socket is down.
 */
export function useAllTickers({ enabled = true }: { enabled?: boolean } = {}) {
  const qc = useQueryClient();
  const status = useRealtimeStatus();
  const query = useQuery({
    queryKey: qk.tickers,
    queryFn: async () => {
      const [spot, futures] = await Promise.all([api.markets.tickers('SPOT'), api.markets.tickers('FUTURES')]);
      return [...spot, ...futures];
    },
    enabled,
    staleTime: 5_000,
    refetchInterval: status === 'connected' ? 60_000 : 5_000,
  });
  useChannel(enabled ? ALL_TICKERS_CHANNEL : null, 'tickers', (list) => {
    qc.setQueryData<TickerDto[]>(qk.tickers, (old) =>
      mergeTickers(
        old,
        list.filter((t) => t.type !== 'OPTIONS'),
      ),
    );
  });
  return query;
}

/** Live 24h ticker for one market. */
export function useTicker(symbol: string | undefined) {
  const qc = useQueryClient();
  const status = useRealtimeStatus();
  const query = useQuery({
    queryKey: qk.ticker(symbol ?? ''),
    queryFn: () => api.markets.ticker(symbol ?? ''),
    enabled: Boolean(symbol),
    refetchInterval: status === 'connected' ? false : 5_000,
    initialData: () => qc.getQueryData<TickerDto[]>(qk.tickers)?.find((t) => t.symbol === symbol),
    // A brand-new market has no ticker until its first trade.
    retry: (failures, e) => errorCode(e) !== 'NOT_FOUND' && failures < 2,
  });
  useChannel(symbol ? marketChannel(symbol, 'ticker') : null, 'ticker', (t) => {
    qc.setQueryData(qk.ticker(t.symbol), t);
  });
  return query;
}

/** Depth snapshot; realtime snapshots are coalesced to ≤4 renders/second. */
export function useOrderBook(symbol: string | undefined) {
  const qc = useQueryClient();
  const status = useRealtimeStatus();
  const live = useIsFocused();
  const pending = useRef<OrderBookDto | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  const query = useQuery({
    queryKey: qk.orderBook(symbol ?? ''),
    queryFn: () => api.markets.orderBook(symbol ?? '', 50),
    enabled: Boolean(symbol),
    staleTime: 2_000,
    refetchInterval: pollEvery(3_000, status === 'connected', live),
  });

  useRefetchOnRefocus(live, query.refetch);
  useChannel(symbol && live ? marketChannel(symbol, 'orderbook') : null, 'orderbook', (book) => {
    pending.current = book;
    timer.current ??= setTimeout(() => {
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next)
        qc.setQueryData<OrderBookDto>(qk.orderBook(next.symbol), (old) => (old && old.seq > next.seq ? old : next));
    }, 250);
  });
  return query;
}

function mergeTrades(old: PublicTradeDto[] | undefined, incoming: PublicTradeDto[]): PublicTradeDto[] {
  const seen = new Set<string>();
  const out: PublicTradeDto[] = [];
  for (const t of [...incoming, ...(old ?? [])]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 40);
}

/** Recent public trades (newest first). */
export function usePublicTrades(symbol: string | undefined) {
  const qc = useQueryClient();
  const status = useRealtimeStatus();
  const live = useIsFocused();
  const query = useQuery({
    queryKey: qk.publicTrades(symbol ?? ''),
    queryFn: async () => mergeTrades(undefined, await api.markets.trades(symbol ?? '', 40)),
    enabled: Boolean(symbol),
    refetchInterval: pollEvery(5_000, status === 'connected', live),
  });
  useRefetchOnRefocus(live, query.refetch);
  useChannel(symbol && live ? marketChannel(symbol, 'trades') : null, 'trades', (trades) => {
    const first = trades[0];
    if (!first) return;
    qc.setQueryData<PublicTradeDto[]>(qk.publicTrades(first.symbol), (old) => mergeTrades(old, trades));
  });
  return query;
}

function upsertCandle(old: CandleDto[] | undefined, c: CandleDto): CandleDto[] | undefined {
  if (!old) return old; // wait for the REST snapshot
  const last = old[old.length - 1];
  if (!last || c.t > last.t) return [...old, c].slice(-600);
  if (c.t === last.t) return [...old.slice(0, -1), c];
  const i = old.findIndex((x) => x.t === c.t);
  if (i < 0) return old;
  const copy = old.slice();
  copy[i] = c;
  return copy;
}

/** OHLCV history plus the live (forming) candle from `market:<symbol>:candles:<tf>`. */
export function useCandles(symbol: string | undefined, tf: Timeframe) {
  const qc = useQueryClient();
  const status = useRealtimeStatus();
  const live = useIsFocused();
  const query = useQuery({
    queryKey: qk.candles(symbol ?? '', tf),
    queryFn: async () => {
      const rows = await api.markets.candles(symbol ?? '', tf, { limit: 300 });
      return rows.slice().sort((a, b) => a.t - b.t);
    },
    enabled: Boolean(symbol),
    staleTime: 30_000,
    refetchInterval: pollEvery(10_000, status === 'connected', live),
  });
  useRefetchOnRefocus(live, query.refetch);
  useChannel(symbol && live ? marketChannel(symbol, `candles:${tf}`) : null, 'candle', (ev) => {
    if (ev.symbol !== symbol || ev.interval !== tf) return;
    qc.setQueryData<CandleDto[]>(qk.candles(ev.symbol, tf), (old) => upsertCandle(old, ev.candle));
  });
  return query;
}

/** Futures mark/index price and funding. */
export function useMarkPrice(symbol: string | undefined) {
  const qc = useQueryClient();
  const status = useRealtimeStatus();
  const query = useQuery({
    queryKey: qk.mark(symbol ?? ''),
    queryFn: () => api.markets.mark(symbol ?? ''),
    enabled: Boolean(symbol),
    refetchInterval: status === 'connected' ? 30_000 : 5_000,
  });
  useChannel(symbol ? marketChannel(symbol, 'mark') : null, 'mark', (m: MarkPriceDto) => {
    qc.setQueryData(qk.mark(m.symbol), m);
  });
  return query;
}
