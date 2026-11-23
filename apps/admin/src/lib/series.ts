import { D, type Decimal } from '@gocrypto/trading-utils';
import type { UTCTimestamp } from 'lightweight-charts';
import { dec } from './format';

export interface VolumePoint {
  /** Hour start, epoch ms. */
  t: number;
  /** Decimal string (USD). */
  volumeUsd: string;
}

const HOUR = 3_600_000;

/**
 * Bucket the API's hourly series into a gap-free 24h window (hours without trades render as 0).
 * Values are summed with decimals and only converted to numbers for plotting.
 */
export function hourlyBuckets(series: readonly VolumePoint[], now = Date.now()): { time: UTCTimestamp; value: number }[] {
  const end = Math.floor(now / HOUR) * HOUR;
  const start = Math.floor((now - 24 * HOUR) / HOUR) * HOUR;
  const sums = new Map<number, Decimal>();
  for (const p of series) {
    const h = Math.floor(p.t / HOUR) * HOUR;
    const v = dec(p.volumeUsd);
    if (!v || h < start || h > end) continue;
    sums.set(h, (sums.get(h) ?? D(0)).plus(v));
  }
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let h = start; h <= end; h += HOUR) out.push({ time: (h / 1000) as UTCTimestamp, value: sums.get(h)?.toNumber() ?? 0 });
  return out;
}
