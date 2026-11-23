import type { Core } from '@gocrypto/server-core';
import { metrics } from '@gocrypto/server-core';

/** Reference prices used to seed the simulator (USD). External mode overrides them with live data. */
export const SEED_PRICES: Record<string, number> = {
  BTC: 92_000,
  ETH: 3_200,
  SOL: 140,
  BNB: 900,
  XRP: 2.2,
  DOGE: 0.16,
  ADA: 0.45,
  LINK: 14,
};

/** Annualised volatility used by the simulator (deliberately lively for a demo exchange). */
const VOL: Record<string, number> = { BTC: 0.9, ETH: 1.1, SOL: 1.4, BNB: 1.0, XRP: 1.3, DOGE: 1.6, ADA: 1.3, LINK: 1.3 };

export interface PriceFeed {
  start(onPrice: (asset: string, price: number) => void): Promise<void>;
  stop(): void;
  readonly source: string;
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Correlated geometric Brownian motion with gentle mean reversion toward a slowly moving anchor
 * (keeps a long-running sandbox in a realistic range). BTC drives the market; alts follow with
 * beta ~0.7 plus idiosyncratic noise.
 */
export class SimulatedFeed implements PriceFeed {
  readonly source = 'simulated';
  private timer: NodeJS.Timeout | null = null;
  private readonly prices = new Map<string, number>();
  private readonly anchors = new Map<string, number>();

  constructor(
    private readonly assets: string[],
    private readonly tickMs = 500,
    initial: Record<string, number> = {},
  ) {
    for (const a of assets) {
      const p = initial[a] ?? SEED_PRICES[a] ?? 1;
      this.prices.set(a, p);
      this.anchors.set(a, SEED_PRICES[a] ?? p);
    }
  }

  async start(onPrice: (asset: string, price: number) => void): Promise<void> {
    const dt = this.tickMs / 1000 / (365 * 24 * 3600);
    const tick = () => {
      const market = gaussian();
      const jump = Math.random() < 0.0015 ? gaussian() * 0.004 : 0;
      for (const a of this.assets) {
        const p = this.prices.get(a)!;
        const sigma = VOL[a] ?? 1.2;
        const z = a === 'BTC' ? market : 0.7 * market + Math.sqrt(1 - 0.49) * gaussian();
        const anchor = this.anchors.get(a)!;
        const reversion = -0.5 * Math.log(p / anchor) * dt * 365; // pulls back over ~days
        const next = p * Math.exp((reversion - (sigma * sigma) / 2) * dt + sigma * Math.sqrt(dt) * z + jump);
        this.prices.set(a, next);
        // Anchor drifts slowly so the market has trends instead of a fixed mean.
        this.anchors.set(a, anchor * Math.exp(0.15 * Math.sqrt(dt) * gaussian()));
        onPrice(a, next);
      }
      metrics.marketDataTicks.inc({ source: this.source });
    };
    tick();
    this.timer = setInterval(tick, this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/**
 * Live index from an external exchange stream (Binance combined trade streams by default,
 * MARKET_DATA_URL). Falls back to the simulator if the feed is unavailable.
 */
export class ExternalFeed implements PriceFeed {
  readonly source = 'external';
  private ws: WebSocket | null = null;
  private fallback: SimulatedFeed | null = null;
  private stopped = false;
  private lastMessage = 0;
  private watchdog: NodeJS.Timeout | null = null;

  constructor(
    private readonly core: Core,
    private readonly assets: string[],
  ) {}

  async start(onPrice: (asset: string, price: number) => void): Promise<void> {
    const streams = this.assets.filter((a) => a !== 'USDT' && a !== 'USDC').map((a) => `${a.toLowerCase()}usdt@trade`);
    const url = `${this.core.config.MARKET_DATA_URL}?streams=${streams.join('/')}`;
    const connect = () => {
      if (this.stopped) return;
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        this.core.log.warn({ err: e }, 'external feed connect failed');
        return this.useFallback(onPrice);
      }
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { data?: { s?: string; p?: string } };
          const sym = msg.data?.s;
          const price = Number(msg.data?.p);
          if (!sym || !Number.isFinite(price)) return;
          this.lastMessage = Date.now();
          onPrice(sym.replace(/USDT$/, ''), price);
          metrics.marketDataTicks.inc({ source: this.source });
        } catch {
          // ignore malformed frames
        }
      };
      this.ws.onclose = () => {
        if (!this.stopped && !this.fallback) setTimeout(connect, 3000);
      };
      this.ws.onerror = () => this.ws?.close();
    };
    connect();
    this.watchdog = setInterval(() => {
      if (!this.fallback && Date.now() - this.lastMessage > 30_000) {
        this.core.log.warn('external market data silent for 30s, switching to simulated feed');
        this.useFallback(onPrice);
      }
    }, 10_000);
  }

  private useFallback(onPrice: (asset: string, price: number) => void): void {
    if (this.fallback) return;
    this.fallback = new SimulatedFeed(this.assets);
    void this.fallback.start(onPrice);
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.ws?.close();
    this.fallback?.stop();
  }
}
