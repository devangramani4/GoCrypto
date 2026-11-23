import { describe, expect, it } from 'vitest';
import {
  type Candle,
  D,
  aggregateCandles,
  atr,
  bollingerBands,
  bucketStart,
  ema,
  formatOptionSymbol,
  heikinAshi,
  keccak256,
  macd,
  nextBucketStart,
  parseOptionSymbol,
  rsi,
  sha256,
  sma,
  stochastic,
  toChecksumAddress,
  toHex,
  validateAddress,
  validateMemo,
  vwap,
} from '../index';

describe('hashes', () => {
  it('sha256 test vectors', () => {
    expect(toHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(toHex(sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('keccak256 test vectors', () => {
    expect(toHex(keccak256(new Uint8Array()))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(toHex(keccak256(new TextEncoder().encode('abc')))).toBe(
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });
});

describe('address validation', () => {
  it('validates EVM addresses with EIP-55', () => {
    for (const a of [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ]) {
      expect(validateAddress('EVM', a)).toEqual({ valid: true, normalized: a });
      expect(toChecksumAddress(a.toLowerCase())).toBe(a);
    }
    expect(validateAddress('EVM', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD').valid).toBe(false);
    expect(validateAddress('EVM', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed').valid).toBe(true);
    expect(validateAddress('EVM', '0x123').valid).toBe(false);
  });

  it('validates bitcoin addresses', () => {
    expect(validateAddress('BTC', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2').valid).toBe(true);
    expect(validateAddress('BTC', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy').valid).toBe(true);
    expect(validateAddress('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').valid).toBe(true);
    expect(validateAddress('BTC', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0').valid).toBe(true);
    expect(validateAddress('BTC', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3').valid).toBe(false);
    expect(validateAddress('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx').valid).toBe(false);
  });

  it('validates tron, solana and xrp', () => {
    expect(validateAddress('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').valid).toBe(true);
    expect(validateAddress('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u').valid).toBe(false);
    expect(validateAddress('SOLANA', 'So11111111111111111111111111111111111111112').valid).toBe(true);
    expect(validateAddress('SOLANA', '0OIl').valid).toBe(false);
    expect(validateAddress('XRP', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh').valid).toBe(true);
    expect(validateMemo('XRP', '12345').valid).toBe(true);
    expect(validateMemo('XRP', 'abc').valid).toBe(false);
  });
});

describe('timeframes', () => {
  it('aligns buckets including weeks and months', () => {
    const ts = Date.UTC(2026, 10, 25, 13, 47, 12); // Wed 2026-11-25
    expect(bucketStart(ts, '1m')).toBe(Date.UTC(2026, 10, 25, 13, 47));
    expect(bucketStart(ts, '15m')).toBe(Date.UTC(2026, 10, 25, 13, 45));
    expect(bucketStart(ts, '4h')).toBe(Date.UTC(2026, 10, 25, 12));
    expect(bucketStart(ts, '1w')).toBe(Date.UTC(2026, 10, 23)); // Monday
    expect(bucketStart(ts, '1M')).toBe(Date.UTC(2026, 10, 1));
    expect(nextBucketStart(ts, '1M')).toBe(Date.UTC(2026, 11, 1));
  });

  it('aggregates candles exactly', () => {
    const mk = (m: number, o: string, h: string, l: string, c: string, v: string): Candle => ({
      openTime: Date.UTC(2026, 0, 1, 0, m),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
      quoteVolume: v,
      trades: 1,
    });
    const out = aggregateCandles(
      [mk(0, '1', '2', '0.5', '1.5', '0.1'), mk(1, '1.5', '3', '1', '2', '0.2'), mk(3, '2', '2', '2', '2', '0.3')],
      '3m',
      (a, b) => D(a).plus(b).toFixed(),
      (a, b) => (D(a).gt(b) ? a : b),
      (a, b) => (D(a).lt(b) ? a : b),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ open: '1', high: '3', low: '0.5', close: '2', volume: '0.3', trades: 2 });
  });
});

describe('option symbols', () => {
  it('round-trips', () => {
    const exp = Date.UTC(2026, 10, 27, 8);
    const s = formatOptionSymbol('BTC', exp, '90000', 'CALL');
    expect(s).toBe('BTC-261127-90000-C');
    expect(parseOptionSymbol(s)).toEqual({ underlying: 'BTC', expiry: exp, strike: '90000', type: 'CALL' });
    expect(parseOptionSymbol('BTCUSDT')).toBeNull();
  });
});

describe('indicators', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.2);
  const bars = closes.map((c, i) => ({ time: i * 60, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 10 + i }));

  it('sma/ema basics', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBeCloseTo(2);
    expect(e[4]).toBeCloseTo(4);
  });

  it('produces bounded oscillators and aligned outputs', () => {
    const r = rsi(closes, 14).filter((v): v is number => v != null);
    expect(r.every((v) => v >= 0 && v <= 100)).toBe(true);
    const m = macd(closes);
    expect(m.macd).toHaveLength(closes.length);
    expect(m.histogram.some((v) => v != null)).toBe(true);
    const bb = bollingerBands(closes, 20);
    expect(bb.upper[30]!).toBeGreaterThan(bb.middle[30]!);
    const st = stochastic(bars);
    expect(st.k.filter((v) => v != null).every((v) => v! >= 0 && v! <= 100)).toBe(true);
    expect(atr(bars, 14)[20]).toBeGreaterThan(0);
    expect(vwap(bars)[10]).toBeGreaterThan(0);
    const ha = heikinAshi(bars);
    expect(ha[5]!.high).toBeGreaterThanOrEqual(Math.max(ha[5]!.open, ha[5]!.close));
  });

  it('rsi is 100 for monotonically rising input', () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(rsi(up, 14)[19]).toBe(100);
  });
});
