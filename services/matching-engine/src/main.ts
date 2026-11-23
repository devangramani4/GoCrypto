/**
 * Matching engine service: single writer of the in-memory order books.
 * Consumes engine commands from a Redis stream, settles matches atomically in MySQL and publishes
 * market data (depth, trades) and private updates (orders, fills, positions) through Redis.
 */
import { Core, acquireLeadership, onShutdown, startHeartbeat, startMetricsServer } from '@gocrypto/server-core';
import { EngineCommandConsumer } from './gateway/gateways';
import { EngineRunner } from './runner/engine-runner';

async function main(): Promise<void> {
  const core = await Core.create('matching-engine');
  const releaseLeadership = await acquireLeadership(core, 'matching-engine', () => process.exit(1));
  const runner = new EngineRunner(core);
  await runner.start();
  const consumer = new EngineCommandConsumer(core, runner);
  await consumer.start();
  const stopHeartbeat = startHeartbeat(core, 'matching-engine', () => runner.stats());
  const metricsServer = startMetricsServer(core.config.METRICS_PORT || 9101, async () => runner.stats());

  onShutdown(core, async () => {
    await consumer.stop();
    await runner.stop();
    stopHeartbeat();
    metricsServer?.close();
    await releaseLeadership();
    await core.close();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
