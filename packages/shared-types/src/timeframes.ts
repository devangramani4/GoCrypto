/** Mirrors @gocrypto/trading-utils TIMEFRAMES so shared-types stays dependency-free. */
export const CHART_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M'] as const;
export type Timeframe = (typeof CHART_TIMEFRAMES)[number];
