/**
 * Market-data service: index feed -> index/mark prices + funding prediction (1s), trade stream ->
 * candles/tickers (in-memory + Redis, batched MySQL persistence), sandbox market maker and backfill.
 */
import { RedisEngineGateway } from '@gocrypto/matching-engine';
import { OrderAdmissionService } from '@gocrypto/risk-engine';
import { Core, acquireLeadership, onShutdown, startHeartbeat, startMetricsServer } from '@gocrypto/server-core';
import { backfillHistory } from './backfill';
import { CandleAndTickerService } from './candles';
import { ExternalFeed, SEED_PRICES, SimulatedFeed, type PriceFeed } from './feeds';
import { MarketMaker } from './market-maker';
import { PriceEngine } from './price-engine';

async function main(): Promise<void> {
  const core = await Core.create('market-data');
  const releaseLeadership = await acquireLeadership(core, 'market-data', () => process.exit(1));
  const assets = core.assets.list().filter((a) => !a.isStable).map((a) => a.symbol);

  // Resume the simulated walk from the last published index prices.
  const initial: Record<string, number> = {};
  for (const a of assets) {
    const p = await core.prices.indexPrice(a);
    if (p) initial[a] = Number(p);
  }
  const candles = new CandleAndTickerService(core);
  const prices = new PriceEngine(core, candles);
  const feed: PriceFeed = core.config.MARKET_DATA_MODE === 'EXTERNAL' ? new ExternalFeed(core, assets) : new SimulatedFeed(assets, 500, initial);
  await feed.start((asset, price) => prices.onIndex(asset, price));
  prices.start();

  if (core.config.isSandbox && core.config.BACKFILL_HISTORY) {
    await new Promise((r) => setTimeout(r, 1500));
    const n = await backfillHistory(core, (m) => {
      const base = prices.indexOf(m.type === 'FUTURES' ? m.futures!.underlying : m.base) ?? SEED_PRICES[m.base] ?? null;
      const quote = m.type === 'SPOT' ? prices.indexOf(m.quote) : 1;
      return base && quote ? base / quote : null;
    }, (asset) => prices.indexOf(asset) ?? SEED_PRICES[asset] ?? null);
    if (n) core.log.info({ candles: n }, 'history backfill complete');
  }
  await candles.start();

  const gateway = await new RedisEngineGateway(core).start();
  let mm: MarketMaker | null = null;
  if (core.config.isSandbox && core.config.MARKET_MAKER_ENABLED) {
    mm = new MarketMaker(core, new OrderAdmissionService(core, gateway), gateway, prices);
    setTimeout(() => void mm!.start(), 3000);
  }

  const stopHeartbeat = startHeartbeat(core, 'market-data', () => ({ feed: feed.source, marketMaker: Boolean(mm) }));
  const metricsServer = startMetricsServer(core.config.METRICS_PORT || 9103);
  onShutdown(core, async () => {
    mm?.stop();
    feed.stop();
    prices.stop();
    await candles.stop();
    stopHeartbeat();
    metricsServer?.close();
    await gateway.close();
    await releaseLeadership();
    await core.close();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
