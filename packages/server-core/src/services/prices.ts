import type { MarkPriceDto, OrderBookDto, PublicTradeDto, TickerDto } from '@gocrypto/shared-types';
import { D, type Decimal } from '@gocrypto/trading-utils';
import type { Redis } from 'ioredis';
import type { AssetCache, MarketCache } from '../cache/markets';
import { key } from '../redis';

/**
 * Read access to real-time market state kept in Redis by the market-data service and the
 * matching engine. Nothing here touches MySQL — high-frequency data never hits the database.
 */
export class PriceService {
  private usdCache: { at: number; prices: Map<string, string> } | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly markets: MarketCache,
    private readonly assets: AssetCache,
  ) {}

  static indexKey(asset: string): string {
    return key('price', 'index', asset);
  }
  static markKey(symbol: string): string {
    return key('price', 'mark', symbol);
  }
  static tickerKey(symbol: string): string {
    return key('ticker', symbol);
  }
  static bookKey(symbol: string): string {
    return key('book', symbol);
  }
  static tradesKey(symbol: string): string {
    return key('trades', symbol);
  }

  async indexPrice(asset: string): Promise<string | null> {
    if (this.assets.bySymbol(asset)?.isStable) return '1';
    return this.redis.get(PriceService.indexKey(asset));
  }

  async markPrice(symbol: string): Promise<MarkPriceDto | null> {
    const raw = await this.redis.get(PriceService.markKey(symbol));
    return raw ? (JSON.parse(raw) as MarkPriceDto) : null;
  }

  async ticker(symbol: string): Promise<TickerDto | null> {
    const raw = await this.redis.get(PriceService.tickerKey(symbol));
    return raw ? (JSON.parse(raw) as TickerDto) : null;
  }

  async tickers(symbols: string[]): Promise<Map<string, TickerDto>> {
    const out = new Map<string, TickerDto>();
    if (symbols.length === 0) return out;
    const raws = await this.redis.mget(symbols.map((s) => PriceService.tickerKey(s)));
    raws.forEach((raw, i) => {
      if (raw) out.set(symbols[i]!, JSON.parse(raw) as TickerDto);
    });
    return out;
  }

  async orderBook(symbol: string): Promise<OrderBookDto | null> {
    const raw = await this.redis.get(PriceService.bookKey(symbol));
    return raw ? (JSON.parse(raw) as OrderBookDto) : null;
  }

  async recentTrades(symbol: string, limit = 50): Promise<PublicTradeDto[]> {
    const raws = await this.redis.lrange(PriceService.tradesKey(symbol), 0, limit - 1);
    return raws.map((r) => JSON.parse(r) as PublicTradeDto);
  }

  /** Last traded price, falling back to mid of the book. */
  async lastPrice(symbol: string): Promise<string | null> {
    const t = await this.ticker(symbol);
    if (t && D(t.lastPrice).gt(0)) return t.lastPrice;
    const b = await this.orderBook(symbol);
    const bid = b?.bids[0]?.[0];
    const ask = b?.asks[0]?.[0];
    if (bid && ask) return D(bid).plus(ask).div(2).toFixed();
    return bid ?? ask ?? null;
  }

  /** Best bid/ask from the engine snapshot. */
  async bestBidAsk(symbol: string): Promise<{ bid: string | null; ask: string | null }> {
    const b = await this.orderBook(symbol);
    return { bid: b?.bids[0]?.[0] ?? null, ask: b?.asks[0]?.[0] ?? null };
  }

  /** USD price of an asset: stablecoins = 1, otherwise index price, otherwise ASSET/USDT last. */
  async usdPrice(asset: string): Promise<string | null> {
    const a = this.assets.bySymbol(asset);
    if (a?.isStable) return '1';
    const idx = await this.redis.get(PriceService.indexKey(asset));
    if (idx) return idx;
    const spot = this.markets.bySymbol(`${asset}USDT`);
    return spot ? this.lastPrice(spot.symbol) : null;
  }

  /** Drop the 1 s USD price cache (prices written out of band, e.g. by tests or operators). */
  clearUsdCache(): void {
    this.usdCache = null;
  }

  /** All USD prices (cached for 1s). */
  async usdPrices(): Promise<Map<string, string>> {
    if (this.usdCache && Date.now() - this.usdCache.at < 1000) return this.usdCache.prices;
    const assets = this.assets.list();
    const keys = assets.map((a) => PriceService.indexKey(a.symbol));
    const raws = keys.length ? await this.redis.mget(keys) : [];
    const prices = new Map<string, string>();
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i]!;
      if (a.isStable) prices.set(a.symbol, '1');
      else if (raws[i]) prices.set(a.symbol, raws[i]!);
      else {
        const p = await this.usdPrice(a.symbol);
        if (p) prices.set(a.symbol, p);
      }
    }
    this.usdCache = { at: Date.now(), prices };
    return prices;
  }

  async toUsd(asset: string, amount: string | Decimal): Promise<Decimal> {
    const p = (await this.usdPrices()).get(asset) ?? (await this.usdPrice(asset));
    return p ? D(amount).mul(p) : D(0);
  }
}
