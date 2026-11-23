/**
 * Workers service: BullMQ job consumers (scale horizontally) plus leader-elected schedulers and the
 * stop/take-profit trigger monitor.
 */
import { RedisEngineGateway } from '@gocrypto/matching-engine';
import { Core, acquireLeadership, onShutdown, startHeartbeat, startMetricsServer } from '@gocrypto/server-core';
import { startJobWorkers } from './jobs';
import { Schedulers } from './schedulers';
import { TriggerMonitor } from './triggers';

async function main(): Promise<void> {
  const core = await Core.create('workers');
  const workers = startJobWorkers(core);
  const gateway = await new RedisEngineGateway(core).start();
  let schedulers: Schedulers | null = null;
  let triggers: TriggerMonitor | null = null;

  // Singleton duties run on the leader only; job consumers run everywhere.
  const leadership = acquireLeadership(core, 'workers-scheduler', () => process.exit(1)).then(async (release) => {
    schedulers = new Schedulers(core, gateway);
    schedulers.start();
    triggers = new TriggerMonitor(core, gateway);
    await triggers.start();
    return release;
  });

  const stopHeartbeat = startHeartbeat(core, 'workers', () => ({ triggers: triggers?.size ?? 0, leader: Boolean(schedulers) }));
  const metricsServer = startMetricsServer(core.config.METRICS_PORT || 9104);
  onShutdown(core, async () => {
    schedulers?.stop();
    await triggers?.stop();
    await Promise.allSettled(workers.map((w) => w.close()));
    stopHeartbeat();
    metricsServer?.close();
    await gateway.close();
    await (await Promise.race([leadership, Promise.resolve(null)]))?.();
    await core.close();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
