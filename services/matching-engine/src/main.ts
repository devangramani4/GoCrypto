/**
 * Matching engine service: single writer of the in-memory order books.
 * Consumes engine commands from a Redis stream, settles matches atomically in MySQL and publishes
 * market data (depth, trades) and private updates (orders, fills, positions) through Redis.
 */
import { Core, acquireLeadership, onShutdown, startHeartbeat, startMetricsServer } from '@gocrypto/server-core';
import { EngineCommandConsumer } from './gateway/gateways';
import { EngineShardMap } from './gateway/shards';
import { EngineRunner } from './runner/engine-runner';

async function main(): Promise<void> {
  const core = await Core.create('matching-engine');
  const shards = EngineShardMap.fromConfig(core);
  const shard = core.config.ENGINE_SHARD;
  if (shard >= shards.count)
    throw new Error(`ENGINE_SHARD (${shard}) must be lower than ENGINE_SHARDS (${shards.count})`);
  // One active instance per shard (hot standbys wait for the lease).
  const name = shards.count > 1 ? `matching-engine-${shard}` : 'matching-engine';
  const releaseLeadership = await acquireLeadership(core, name, () => process.exit(1));
  const runner = new EngineRunner(core, {
    owns: shards.count > 1 ? (marketId) => shards.shardOf(marketId) === shard : undefined,
  });
  await runner.start();
  const consumer = new EngineCommandConsumer(core, runner, shards.stream(shard));
  await consumer.start();
  core.log.info({ shard, shards: shards.count, stream: shards.stream(shard) }, 'engine shard serving');
  const stopHeartbeat = startHeartbeat(core, name, () => ({ shard, ...runner.stats() }));
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
