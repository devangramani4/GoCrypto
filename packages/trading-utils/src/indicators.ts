/**
 * Technical indicators for charting. Inputs/outputs are plain numbers because charts are a
 * display concern; nothing here feeds back into balances or order execution.
 * Each function returns an array aligned with the input (null where the indicator is undefined).
 */
export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Series = (number | null)[];

export function sma(values: readonly number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: readonly number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: readonly number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i]! - values[i - 1]!;
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(values: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastE = ema(values, fast);
  const slowE = ema(values, slow);
  const macdLine: Series = values.map((_, i) => {
    const f = fastE[i];
    const s = slowE[i];
    return f == null || s == null ? null : f - s;
  });
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signal: Series = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const compact = macdLine.slice(firstIdx).map((v) => v ?? 0);
    const sig = ema(compact, signalPeriod);
    sig.forEach((v, j) => {
      signal[firstIdx + j] = v;
    });
  }
  const histogram: Series = macdLine.map((m, i) => {
    const s = signal[i];
    return m == null || s == null ? null : m - s;
  });
  return { macd: macdLine, signal, histogram };
}

export interface BandsResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollingerBands(values: readonly number[], period = 20, multiplier = 2): BandsResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = middle[i];
    if (m == null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j]! - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + multiplier * sd;
    lower[i] = m - multiplier * sd;
  }
  return { upper, middle, lower };
}

/**
 * Session VWAP. Resets at each UTC day boundary (sessionMs, default 1 day).
 * `time` is in seconds or ms — anything monotonic works as long as sessionMs uses the same unit.
 */
export function vwap(bars: readonly OhlcvBar[], sessionLength = 86_400): Series {
  const out: Series = new Array(bars.length).fill(null);
  let session = -1;
  let pv = 0;
  let vol = 0;
  bars.forEach((b, i) => {
    const s = Math.floor(b.time / sessionLength);
    if (s !== session) {
      session = s;
      pv = 0;
      vol = 0;
    }
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume;
    vol += b.volume;
    out[i] = vol > 0 ? pv / vol : typical;
  });
  return out;
}

export interface StochasticResult {
  k: Series;
  d: Series;
}

export function stochastic(bars: readonly OhlcvBar[], kPeriod = 14, kSmoothing = 3, dPeriod = 3): StochasticResult {
  const raw: number[] = [];
  const rawIdx: number[] = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j]!.high);
      ll = Math.min(ll, bars[j]!.low);
    }
    raw.push(hh === ll ? 50 : ((bars[i]!.close - ll) / (hh - ll)) * 100);
    rawIdx.push(i);
  }
  const kSm = sma(raw, kSmoothing);
  const dSm = sma(
    kSm.map((v) => v ?? 0),
    dPeriod,
  );
  const k: Series = new Array(bars.length).fill(null);
  const d: Series = new Array(bars.length).fill(null);
  rawIdx.forEach((barIdx, j) => {
    k[barIdx] = kSm[j] ?? null;
    d[barIdx] = j >= kSmoothing - 1 + dPeriod - 1 ? (dSm[j] ?? null) : null;
  });
  return { k, d };
}

/** Average True Range (Wilder smoothing). */
export function atr(bars: readonly OhlcvBar[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr: number[] = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1]!.close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i]!;
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** Heikin Ashi transformation. */
export function heikinAshi(bars: readonly OhlcvBar[]): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const prev = out[i - 1];
    const open = prev ? (prev.open + prev.close) / 2 : (b.open + b.close) / 2;
    out.push({
      time: b.time,
      open,
      close,
      high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close),
      volume: b.volume,
    });
  });
  return out;
}
