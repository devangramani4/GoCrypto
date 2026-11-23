/**
 * API service entrypoint. With ENGINE_MODE=inprocess the matching engine runs inside this process
 * (single-node development); otherwise orders are routed to the matching-engine service via Redis.
 */
import { EngineRunner, InProcessEngineGateway, RedisEngineGateway } from '@gocrypto/matching-engine';
import { OrderAdmissionService } from '@gocrypto/risk-engine';
import { Core, type EngineGateway, acquireLeadership, onShutdown, startHeartbeat } from '@gocrypto/server-core';
import { buildApp } from './app';

async function main(): Promise<void> {
  const core = await Core.create('api');
  let engine: EngineGateway;
  let runner: EngineRunner | undefined;
  let releaseLeader: (() => Promise<void>) | null = null;
  if (core.config.ENGINE_MODE === 'inprocess') {
    releaseLeader = await acquireLeadership(core, 'matching-engine', () => process.exit(1));
    runner = new EngineRunner(core);
    await runner.start();
    engine = new InProcessEngineGateway(runner);
  } else {
    engine = await new RedisEngineGateway(core).start();
  }
  const admission = new OrderAdmissionService(core, engine);
  const app = await buildApp({ core, engine, admission, runner }, { logRequests: core.config.LOG_LEVEL === 'debug' });
  await app.listen({ host: core.config.API_HOST, port: core.config.API_PORT });
  core.log.info({ port: core.config.API_PORT, engine: core.config.ENGINE_MODE, mode: core.config.TRADING_MODE }, 'API listening (docs at /docs)');
  const stopHeartbeat = startHeartbeat(core, 'api', () => (runner ? { engine: runner.stats() } : {}));

  onShutdown(core, async () => {
    await app.close();
    stopHeartbeat();
    await engine.close();
    await runner?.stop();
    await releaseLeader?.();
    await core.close();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
