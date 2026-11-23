import type { TickerDto } from '@gocrypto/shared-types';
import { ALL_TICKERS_CHANNEL, marketChannel } from '@gocrypto/shared-types';
import {
  type Core,
  type MarketInfo,
  PriceService,
  STREAMS,
  StreamConsumer,
  type TradeStreamEntry,
  liveCandleKey,
} from '@gocrypto/server-core';
import { type Candle, D, STORED_TIMEFRAMES, TIMEFRAMES, type Timeframe, ZERO, bucketStart, toDb, toPlain } from '@gocrypto/trading-utils';

interface MinuteBucket {
  t: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: number;
}

/**
 * Consumes executed trades (Redis stream) and maintains:
 *  - live candles for every timeframe (Redis + WebSocket), persisted in batches every few seconds
 *  - rolling 24h tickers from 1-minute buckets
 * High-frequency data stays in memory/Redis; MySQL only receives coalesced upserts.
 */
export class CandleAndTickerService {
  private readonly candles = new Map<string, Candle>(); // `${marketId}:${tf}`
  private readonly dirty = new Set<string>();
  /** Candles that closed since the last flush (their in-memory slot already holds the next bucket). */
  private closed: { key: string; candle: Candle }[] = [];
  private readonly minutes = new Map<number, MinuteBucket[]>(); // marketId -> last 24h of 1m buckets
  private readonly tickerDirty = new Set<number>();
  private consumer: StreamConsumer<TradeStreamEntry> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private tickerTimer: NodeJS.Timeout | null = null;
  private allTickersTimer: NodeJS.Timeout | null = null;
  private extra = new Map<string, Partial<TickerDto>>();

  constructor(private readonly core: Core) {}

  async start(): Promise<void> {
    await this.warmup();
    this.consumer = new StreamConsumer<TradeStreamEntry>(
      this.core.redis.blocking('trades-candles'),
      STREAMS.trades,
      'market-data-candles',
      'market-data',
      async (messages) => {
        for (const m of messages) this.onTrade(m.data);
      },
      { batch: 1000, blockMs: 1000, startId: '$' },
    );
    await this.consumer.start();
    this.flushTimer = setInterval(() => void this.flush().catch((e) => this.core.log.error({ err: e }, 'candle flush failed')), 3000);
    this.tickerTimer = setInterval(() => void this.publishTickers(), 500);
    this.allTickersTimer = setInterval(() => void this.publishAllTickers(), 2000);
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.tickerTimer) clearInterval(this.tickerTimer);
    if (this.allTickersTimer) clearInterval(this.allTickersTimer);
    await this.consumer?.stop();
    await this.flush();
  }

  /** Futures extras (mark/index/funding) merged into tickers. */
  setTickerExtras(symbol: string, extra: Partial<TickerDto>): void {
    this.extra.set(symbol, { ...this.extra.get(symbol), ...extra });
    const m = this.core.markets.bySymbol(symbol);
    if (m) this.tickerDirty.add(m.id);
  }

  /** Rebuild state (live candles + 24h minute buckets) from persisted candles. */
  private async warmup(): Promise<void> {
    const since = Date.now() - 24 * 3600_000;
    for (const m of this.core.markets.list()) {
      if (m.type === 'OPTIONS') continue;
      const rows = await this.core.db.query<Record<string, unknown>>(
        "SELECT open_time, open, high, low, close, volume, quote_volume, trade_count FROM candles WHERE market_id = ? AND timeframe = '1m' AND open_time >= ? ORDER BY open_time",
        [m.id, since],
      );
      this.minutes.set(
        m.id,
        rows.map((r) => ({
          t: Number(r.open_time),
          open: toPlain(String(r.open)),
          high: toPlain(String(r.high)),
          low: toPlain(String(r.low)),
          close: toPlain(String(r.close)),
          volume: toPlain(String(r.volume)),
          quoteVolume: toPlain(String(r.quote_volume)),
          trades: Number(r.trade_count),
        })),
      );
      for (const tf of TIMEFRAMES) {
        const cached = await this.core.redis.main.get(liveCandleKey(m.symbol, tf));
        if (cached) {
          const c = JSON.parse(cached) as Candle;
          if (c.openTime === bucketStart(Date.now(), tf)) this.candles.set(`${m.id}:${tf}`, c);
        }
      }
      this.tickerDirty.add(m.id);
    }
  }

  onTrade(t: TradeStreamEntry): void {
    const market = this.core.markets.byId(t.marketId);
    if (!market) return;
    for (const tf of TIMEFRAMES) {
      const k = `${market.id}:${tf}`;
      const start = bucketStart(t.ts, tf);
      let c = this.candles.get(k);
      if (!c || c.openTime < start) {
        if (c && this.dirty.has(k)) this.closed.push({ key: k, candle: c });
        c = { openTime: start, open: t.price, high: t.price, low: t.price, close: t.price, volume: '0', quoteVolume: '0', trades: 0 };
        this.candles.set(k, c);
      }
      if (c.openTime > start) continue; // late trade for an older bucket: ignore for live state
      if (D(t.price).gt(c.high)) c.high = t.price;
      if (D(t.price).lt(c.low)) c.low = t.price;
      c.close = t.price;
      c.volume = D(c.volume).plus(t.qty).toFixed();
      c.quoteVolume = D(c.quoteVolume).plus(t.quoteQty).toFixed();
      c.trades += 1;
      this.dirty.add(k);
    }
    // 24h minute buckets
    const list = this.minutes.get(market.id) ?? [];
    const minute = bucketStart(t.ts, '1m');
    let last = list[list.length - 1];
    if (!last || last.t < minute) {
      last = { t: minute, open: t.price, high: t.price, low: t.price, close: t.price, volume: '0', quoteVolume: '0', trades: 0 };
      list.push(last);
    }
    if (D(t.price).gt(last.high)) last.high = t.price;
    if (D(t.price).lt(last.low)) last.low = t.price;
    last.close = t.price;
    last.volume = D(last.volume).plus(t.qty).toFixed();
    last.quoteVolume = D(last.quoteVolume).plus(t.quoteQty).toFixed();
    last.trades += 1;
    const cutoff = Date.now() - 24 * 3600_000;
    while (list.length && list[0]!.t < cutoff) list.shift();
    this.minutes.set(market.id, list);
    this.tickerDirty.add(market.id);
  }

  private async publishCandles(keys: string[]): Promise<void> {
    const pipe = this.core.redis.pub.pipeline();
    for (const k of keys) {
      const c = this.candles.get(k);
      if (!c) continue;
      const [marketId, tf] = k.split(':') as [string, Timeframe];
      const market = this.core.markets.byId(Number(marketId));
      if (!market) continue;
      pipe.set(liveCandleKey(market.symbol, tf), JSON.stringify(c), 'EX', 7 * 86_400);
      this.core.bus.ws(marketChannel(market.symbol, `candles:${tf}`), 'candle', {
        symbol: market.symbol,
        interval: tf,
        candle: { t: c.openTime, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, qv: c.quoteVolume, n: c.trades },
      });
    }
    await pipe.exec();
  }

  /** Coalesced, batched upsert of changed candles for persisted timeframes. */
  async flush(): Promise<void> {
    if (!this.dirty.size && !this.closed.length) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    const closed = this.closed;
    this.closed = [];
    await this.publishCandles(keys);
    const rows: unknown[][] = [];
    const push = (k: string, c: Candle) => {
      const [marketId, tf] = k.split(':') as [string, Timeframe];
      if (!STORED_TIMEFRAMES.includes(tf)) return;
      rows.push([Number(marketId), tf, c.openTime, toDb(c.open), toDb(c.high), toDb(c.low), toDb(c.close), toDb(c.volume), toDb(c.quoteVolume), c.trades]);
    };
    for (const { key: k, candle } of closed) push(k, candle);
    for (const k of keys) {
      const c = this.candles.get(k);
      if (c) push(k, c);
    }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await this.core.db.execute(
        `INSERT INTO candles (market_id, timeframe, open_time, open, high, low, close, volume, quote_volume, trade_count)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
         ON DUPLICATE KEY UPDATE high = GREATEST(high, VALUES(high)), low = LEAST(low, VALUES(low)), close = VALUES(close),
           volume = VALUES(volume), quote_volume = VALUES(quote_volume), trade_count = VALUES(trade_count)`,
        chunk.flat(),
      );
    }
  }

  ticker(market: MarketInfo): TickerDto | null {
    const list = this.minutes.get(market.id) ?? [];
    const cutoff = Date.now() - 24 * 3600_000;
    const window = list.filter((b) => b.t >= cutoff);
    const extra = this.extra.get(market.symbol) ?? {};
    if (!window.length) {
      const last = extra.markPrice ?? null;
      if (!last) return null;
      return {
        symbol: market.symbol,
        type: market.type,
        lastPrice: last,
        open: last,
        high: last,
        low: last,
        volume: '0',
        quoteVolume: '0',
        priceChange: '0',
        priceChangePercent: '0',
        bestBid: null,
        bestBidQty: null,
        bestAsk: null,
        bestAskQty: null,
        trades: 0,
        ts: Date.now(),
        ...extra,
      };
    }
    let high = window[0]!.high;
    let low = window[0]!.low;
    let volume = ZERO;
    let quote = ZERO;
    let trades = 0;
    for (const b of window) {
      if (D(b.high).gt(high)) high = b.high;
      if (D(b.low).lt(low)) low = b.low;
      volume = volume.plus(b.volume);
      quote = quote.plus(b.quoteVolume);
      trades += b.trades;
    }
    const open = window[0]!.open;
    const last = window[window.length - 1]!.close;
    const change = D(last).minus(open);
    return {
      symbol: market.symbol,
      type: market.type,
      lastPrice: last,
      open,
      high,
      low,
      volume: toPlain(volume),
      quoteVolume: toPlain(quote.toDecimalPlaces(8)),
      priceChange: toPlain(change),
      priceChangePercent: D(open).gt(0) ? toPlain(change.div(open).toDecimalPlaces(6)) : '0',
      bestBid: null,
      bestBidQty: null,
      bestAsk: null,
      bestAskQty: null,
      trades,
      ts: Date.now(),
      ...extra,
    };
  }

  private async publishTickers(): Promise<void> {
    if (!this.tickerDirty.size) return;
    const ids = [...this.tickerDirty];
    this.tickerDirty.clear();
    const pipe = this.core.redis.pub.pipeline();
    for (const id of ids) {
      const market = this.core.markets.byId(id);
      if (!market) continue;
      const t = this.ticker(market);
      if (!t) continue;
      const book = await this.core.prices.orderBook(market.symbol);
      if (book) {
        t.bestBid = book.bids[0]?.[0] ?? null;
        t.bestBidQty = book.bids[0]?.[1] ?? null;
        t.bestAsk = book.asks[0]?.[0] ?? null;
        t.bestAskQty = book.asks[0]?.[1] ?? null;
      }
      pipe.set(PriceService.tickerKey(market.symbol), JSON.stringify(t));
      this.core.bus.ws(marketChannel(market.symbol, 'ticker'), 'ticker', t);
    }
    await pipe.exec();
  }

  private async publishAllTickers(): Promise<void> {
    const markets = this.core.markets.list().filter((m) => m.type !== 'OPTIONS' && m.status === 'TRADING');
    const map = await this.core.prices.tickers(markets.map((m) => m.symbol));
    this.core.bus.ws(ALL_TICKERS_CHANNEL, 'tickers', [...map.values()]);
  }
}
