export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Fixed-length timeframes in ms. `1M` is calendar based and therefore absent. */
export const TIMEFRAME_MS: Record<Exclude<Timeframe, '1M'>, number> = {
  '1m': MINUTE,
  '3m': 3 * MINUTE,
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '30m': 30 * MINUTE,
  '1h': HOUR,
  '2h': 2 * HOUR,
  '4h': 4 * HOUR,
  '1d': DAY,
  '1w': 7 * DAY,
};

/** Timeframes persisted by the market-data service (others are aggregated on read). */
export const STORED_TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

/** Source timeframe used to aggregate a non-stored timeframe. */
export const AGGREGATION_SOURCE: Partial<Record<Timeframe, Timeframe>> = {
  '3m': '1m',
  '30m': '15m',
  '2h': '1h',
  '1w': '1d',
  '1M': '1d',
};

export function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === 'string' && (TIMEFRAMES as readonly string[]).includes(v);
}

/** Bucket start (UTC, ms) for a timestamp. Weeks start Monday 00:00 UTC; months on the 1st. */
export function bucketStart(ts: number, tf: Timeframe): number {
  if (tf === '1M') {
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  if (tf === '1w') {
    // 1970-01-01 was a Thursday; shift by 3 days so buckets begin on Monday.
    const offset = 3 * DAY;
    return Math.floor((ts + offset) / TIMEFRAME_MS['1w']) * TIMEFRAME_MS['1w'] - offset;
  }
  const len = TIMEFRAME_MS[tf];
  return Math.floor(ts / len) * len;
}

/** Start of the bucket after the one containing `ts`. */
export function nextBucketStart(ts: number, tf: Timeframe): number {
  const start = bucketStart(ts, tf);
  if (tf === '1M') {
    const d = new Date(start);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return start + TIMEFRAME_MS[tf];
}

export interface Candle {
  /** Bucket open time in ms. */
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: number;
}

/**
 * Aggregate finer candles into a coarser timeframe. Input must be sorted ascending.
 * Volumes are summed as decimal strings to avoid float drift.
 */
export function aggregateCandles(
  candles: readonly Candle[],
  target: Timeframe,
  add: (a: string, b: string) => string,
  max: (a: string, b: string) => string,
  min: (a: string, b: string) => string,
): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const b = bucketStart(c.openTime, target);
    if (!cur || cur.openTime !== b) {
      if (cur) out.push(cur);
      cur = { ...c, openTime: b };
      continue;
    }
    cur.high = max(cur.high, c.high);
    cur.low = min(cur.low, c.low);
    cur.close = c.close;
    cur.volume = add(cur.volume, c.volume);
    cur.quoteVolume = add(cur.quoteVolume, c.quoteVolume);
    cur.trades += c.trades;
  }
  if (cur) out.push(cur);
  return out;
}
