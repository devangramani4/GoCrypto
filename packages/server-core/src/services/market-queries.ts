import type { CandleDto, TickerDto } from '@gocrypto/shared-types';
import {
  AGGREGATION_SOURCE,
  type Candle,
  D,
  STORED_TIMEFRAMES,
  TIMEFRAME_MS,
  type Timeframe,
  aggregateCandles,
  bucketStart,
  toPlain,
} from '@gocrypto/trading-utils';
import type { MarketInfo } from '../cache/markets';
import type { Core } from '../core';
import { key } from '../redis';

const add = (a: string, b: string) => D(a).plus(b).toFixed();
const max = (a: string, b: string) => (D(a).gt(b) ? a : b);
const min = (a: string, b: string) => (D(a).lt(b) ? a : b);

export function liveCandleKey(symbol: string, tf: Timeframe): string {
  return key('candle', symbol, tf);
}

function toDto(c: Candle): CandleDto {
  return { t: c.openTime, o: toPlain(c.open), h: toPlain(c.high), l: toPlain(c.low), c: toPlain(c.close), v: toPlain(c.volume), qv: toPlain(c.quoteVolume), n: c.trades };
}

/** Read side for market data: candles (persisted + live) and tickers. */
export class MarketQueries {
  constructor(private readonly core: Core) {}

  private async stored(marketId: number, tf: Timeframe, from: number | undefined, to: number, limit: number): Promise<Candle[]> {
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT open_time, open, high, low, close, volume, quote_volume, trade_count FROM candles
        WHERE market_id = ? AND timeframe = ? AND open_time <= ? ${from ? 'AND open_time >= ?' : ''}
        ORDER BY open_time DESC LIMIT ?`,
      from ? [marketId, tf, to, from, limit] : [marketId, tf, to, limit],
    );
    return rows
      .map((r) => ({
        openTime: Number(r.open_time),
        open: String(r.open),
        high: String(r.high),
        low: String(r.low),
        close: String(r.close),
        volume: String(r.volume),
        quoteVolume: String(r.quote_volume),
        trades: Number(r.trade_count),
      }))
      .reverse();
  }

  private async live(symbol: string, tf: Timeframe): Promise<Candle | null> {
    const raw = await this.core.redis.main.get(liveCandleKey(symbol, tf));
    return raw ? (JSON.parse(raw) as Candle) : null;
  }

  async candles(market: MarketInfo, tf: Timeframe, opts: { from?: number; to?: number; limit: number }): Promise<CandleDto[]> {
    const to = opts.to ?? Date.now();
    const limit = Math.min(opts.limit, 1500);
    let candles: Candle[];
    if (STORED_TIMEFRAMES.includes(tf)) {
      candles = await this.stored(market.id, tf, opts.from, to, limit);
      const live = await this.live(market.symbol, tf);
      if (live && (!opts.to || live.openTime <= to)) {
        const last = candles[candles.length - 1];
        if (last && last.openTime === live.openTime) candles[candles.length - 1] = live;
        else if (!last || live.openTime > last.openTime) candles.push(live);
      }
    } else {
      const source = AGGREGATION_SOURCE[tf]!;
      const ratio = tf === '1M' ? 31 : Math.ceil((TIMEFRAME_MS as Record<string, number>)[tf]! / (TIMEFRAME_MS as Record<string, number>)[source]!);
      const from = opts.from ? bucketStart(opts.from, tf) : undefined;
      const src = await this.stored(market.id, source, from, to, Math.min(limit * ratio + ratio, 20_000));
      const live = await this.live(market.symbol, source);
      if (live) {
        const last = src[src.length - 1];
        if (last && last.openTime === live.openTime) src[src.length - 1] = live;
        else if (!last || live.openTime > last.openTime) src.push(live);
      }
      candles = aggregateCandles(src, tf, add, max, min).slice(-limit);
    }
    return candles.slice(-limit).map(toDto);
  }

  async tickers(type?: MarketInfo['type']): Promise<TickerDto[]> {
    const markets = this.core.markets.list(type).filter((m) => m.status === 'TRADING' || m.status === 'HALTED');
    const map = await this.core.prices.tickers(markets.map((m) => m.symbol));
    return markets.map((m) => map.get(m.symbol)).filter((t): t is TickerDto => Boolean(t));
  }
}
