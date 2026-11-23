import type { Core, MarketInfo } from '@gocrypto/server-core';
import { type Candle, D, type Timeframe, aggregateCandles, toDb } from '@gocrypto/trading-utils';

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function decimalsFor(price: number): number {
  return price >= 1000 ? 2 : price >= 10 ? 3 : price >= 1 ? 4 : 6;
}

/** Generate a path backwards in time that ends exactly at `endPrice`. */
function backwardPath(endPrice: number, bars: number, stepSigma: number): number[] {
  const closes = new Array<number>(bars);
  closes[bars - 1] = endPrice;
  for (let i = bars - 2; i >= 0; i--) closes[i] = closes[i + 1]! * Math.exp(-stepSigma * gaussian());
  return closes;
}

function barsFromPath(closes: number[], startTime: number, stepMs: number, sigma: number, volumeBase: number, usdPerUnit: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i]!;
    const open = i === 0 ? close * Math.exp(sigma * gaussian() * 0.5) : closes[i - 1]!;
    const wick = Math.abs(gaussian()) * sigma * 0.6;
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - Math.abs(gaussian()) * sigma * 0.6);
    const d = decimalsFor(close);
    const volume = volumeBase * Math.exp(gaussian() * 0.6) * (1 + Math.abs(close / open - 1) * 40);
    out.push({
      openTime: startTime + i * stepMs,
      open: open.toFixed(d),
      high: high.toFixed(d),
      low: low.toFixed(d),
      close: close.toFixed(d),
      volume: volume.toFixed(6),
      quoteVolume: (volume * close).toFixed(4),
      trades: Math.max(1, Math.round((volume * usdPerUnit) / 1500)),
    });
  }
  return out;
}

const add = (a: string, b: string) => D(a).plus(b).toFixed();
const max = (a: string, b: string) => (D(a).gt(b) ? a : b);
const min = (a: string, b: string) => (D(a).lt(b) ? a : b);

/**
 * Sandbox only: synthesise one year of hourly and three days of minute history for markets with
 * no candles yet, so charts have context on a fresh install. Real candles are never overwritten.
 */
export async function backfillHistory(
  core: Core,
  priceOf: (m: MarketInfo) => number | null,
  usdOf: (asset: string) => number | null,
): Promise<number> {
  let total = 0;
  for (const m of core.markets.list()) {
    if (m.type === 'OPTIONS') continue;
    const existing = await core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM candles WHERE market_id = ?', [m.id]);
    if (Number(existing?.c ?? 0) > 0) continue;
    const price = priceOf(m);
    if (!price) continue;
    const now = Date.now();
    const minuteStart = Math.floor(now / 60_000) * 60_000 - 3 * 86_400_000;
    const minuteBars = 3 * 1440;
    const sigmaMinute = 0.0009;
    // Volume in base units sized from the base asset's USD value (~$25k per minute).
    const baseUsd = usdOf(m.type === 'FUTURES' ? m.futures!.underlying : m.base) ?? price;
    const volBase = 25_000 / baseUsd;
    const minutes = barsFromPath(backwardPath(price, minuteBars, sigmaMinute), minuteStart, 60_000, sigmaMinute, volBase, baseUsd);
    const hourBars = 365 * 24;
    const firstMinuteOpen = Number(minutes[0]!.open);
    const hourStart = minuteStart - hourBars * 3_600_000;
    const hours = barsFromPath(backwardPath(firstMinuteOpen, hourBars, 0.007), hourStart, 3_600_000, 0.007, volBase * 60, baseUsd);
    const recentHours = aggregateCandles(minutes, '1h', add, max, min);
    const allHours = [...hours, ...recentHours];
    const sets: [Timeframe, Candle[]][] = [
      ['1m', minutes],
      ['5m', aggregateCandles(minutes, '5m', add, max, min)],
      ['15m', aggregateCandles(minutes, '15m', add, max, min)],
      ['1h', allHours],
      ['4h', aggregateCandles(allHours, '4h', add, max, min)],
      ['1d', aggregateCandles(allHours, '1d', add, max, min)],
    ];
    for (const [tf, candles] of sets) {
      for (let i = 0; i < candles.length; i += 1000) {
        const chunk = candles.slice(i, i + 1000);
        await core.db.execute(
          `INSERT IGNORE INTO candles (market_id, timeframe, open_time, open, high, low, close, volume, quote_volume, trade_count)
           VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          chunk.flatMap((c) => [m.id, tf, c.openTime, toDb(c.open), toDb(c.high), toDb(c.low), toDb(c.close), toDb(c.volume), toDb(c.quoteVolume), c.trades]),
        );
        total += chunk.length;
      }
    }
    core.log.info({ symbol: m.symbol }, 'synthetic history backfilled');
  }
  return total;
}
