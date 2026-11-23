import type { MarkPriceDto } from '@gocrypto/shared-types';
import { marketChannel } from '@gocrypto/shared-types';
import { type Core, FundingService, type MarketInfo, PriceService } from '@gocrypto/server-core';
import { D, fundingRate, roundToStep, toPlain } from '@gocrypto/trading-utils';
import type { CandleAndTickerService } from './candles';

interface PremiumState {
  sum: number;
  n: number;
  periodStart: number;
  ema: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function fmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const decimals = n >= 1000 ? 4 : n >= 1 ? 6 : 8;
  return toPlain(D(n.toFixed(decimals)));
}

/**
 * Publishes index prices (per asset) and futures mark prices once per second.
 *
 * Mark price = median(index x (1 + funding basis), index x (1 + EMA premium), last price)
 * Predicted funding = clamp(TWAP premium + clamp(interest - premium, ±0.05%), ±cap)
 * where premium = (max(0, impactBid - index) - max(0, index - impactAsk)) / index.
 */
export class PriceEngine {
  private readonly index = new Map<string, number>();
  private readonly premium = new Map<number, PremiumState>();
  private readonly openInterest = new Map<number, string>();
  private timer: NodeJS.Timeout | null = null;
  private oiTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly core: Core,
    private readonly tickers: CandleAndTickerService,
  ) {}

  onIndex(asset: string, price: number): void {
    this.index.set(asset, price);
  }

  indexOf(asset: string): number | null {
    if (asset === 'USDT' || asset === 'USDC') return 1;
    return this.index.get(asset) ?? null;
  }

  start(): void {
    this.timer = setInterval(() => void this.publish().catch((e) => this.core.log.error({ err: e }, 'price publish failed')), 1000);
    this.oiTimer = setInterval(() => void this.refreshOpenInterest(), 10_000);
    void this.refreshOpenInterest();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.oiTimer) clearInterval(this.oiTimer);
  }

  private async refreshOpenInterest(): Promise<void> {
    const rows = await this.core.db.query<{ market_id: number; oi: string }>(
      "SELECT market_id, SUM(quantity) AS oi FROM futures_positions WHERE status = 'OPEN' AND side = 'LONG' GROUP BY market_id",
    );
    for (const r of rows) this.openInterest.set(Number(r.market_id), toPlain(r.oi));
  }

  private impactPrices(book: { bids: [string, string][]; asks: [string, string][] } | null, notional = 1000): { bid: number | null; ask: number | null } {
    const walk = (levels: [string, string][]) => {
      let filled = 0;
      let cost = 0;
      for (const [p, q] of levels) {
        const price = Number(p);
        const take = Math.min(Number(q), (notional - cost) / price);
        filled += take;
        cost += take * price;
        if (cost >= notional - 1e-9) break;
      }
      return filled > 0 && cost >= notional * 0.999 ? cost / filled : null;
    };
    return { bid: book ? walk(book.bids) : null, ask: book ? walk(book.asks) : null };
  }

  private async publish(): Promise<void> {
    const pipe = this.core.redis.pub.pipeline();
    const now = Date.now();
    for (const [asset, price] of this.index) {
      const p = fmt(price);
      pipe.set(PriceService.indexKey(asset), p);
      this.core.bus.emit('price.index', { asset, price: p, ts: now });
    }
    for (const m of this.core.markets.list('FUTURES')) {
      if (m.status !== 'TRADING' || !m.futures) continue;
      const idx = this.indexOf(m.futures.underlying);
      if (!idx) continue;
      const dto = await this.markFor(m, idx, now);
      pipe.set(PriceService.markKey(m.symbol), JSON.stringify(dto));
      this.core.bus.emit('price.mark', { ...dto, marketId: m.id });
      this.core.bus.ws(marketChannel(m.symbol, 'mark'), 'mark', dto);
      this.tickers.setTickerExtras(m.symbol, {
        markPrice: dto.markPrice,
        indexPrice: dto.indexPrice,
        fundingRate: dto.fundingRate,
        nextFundingTime: dto.nextFundingTime,
        openInterest: this.openInterest.get(m.id) ?? '0',
      });
    }
    await pipe.exec();
  }

  private async markFor(m: MarketInfo, idx: number, now: number): Promise<MarkPriceDto> {
    const fut = m.futures!;
    const interval = fut.fundingIntervalHours * 3_600_000;
    const next = FundingService.nextFundingTime(fut.fundingIntervalHours, now);
    const periodStart = next - interval;
    let st = this.premium.get(m.id);
    if (!st || st.periodStart !== periodStart) {
      st = { sum: 0, n: 0, periodStart, ema: st?.ema ?? 0 };
      this.premium.set(m.id, st);
    }
    const book = await this.core.prices.orderBook(m.symbol);
    const { bid, ask } = this.impactPrices(book);
    const premium = ((bid ? Math.max(0, bid - idx) : 0) - (ask ? Math.max(0, idx - ask) : 0)) / idx;
    st.sum += premium;
    st.n += 1;
    st.ema = st.ema * 0.9 + premium * 0.1;
    const avgPremium = st.sum / st.n;
    const rate = fundingRate(avgPremium.toFixed(10), fut.interestRate, fut.maxFundingRate);
    const basis = Math.max(-0.005, Math.min(0.005, st.ema));
    const timeFraction = (next - now) / interval;
    const price1 = idx * (1 + Number(rate) * timeFraction);
    const price2 = idx * (1 + basis);
    const last = await this.core.prices.lastPrice(m.symbol);
    const lastNum = last ? Number(last) : null;
    // Ignore a last price that is far from the index (thin book) to keep the mark manipulation-resistant.
    const candidates = lastNum && Math.abs(lastNum / idx - 1) < 0.03 ? [price1, price2, lastNum] : [price1, price2, price2];
    const mark = roundToStep(D(median(candidates).toFixed(10)), m.tickSize);
    return {
      symbol: m.symbol,
      markPrice: toPlain(mark),
      indexPrice: fmt(idx),
      fundingRate: toPlain(rate),
      nextFundingTime: next,
      ts: now,
    };
  }
}
