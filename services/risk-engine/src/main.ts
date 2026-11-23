/**
 * Risk engine service: liquidation monitor (event-driven on mark prices), liquidation warnings and
 * insurance-fund position unwinding. Order admission runs inside the API using the same module.
 */
import { RedisEngineGateway } from '@gocrypto/matching-engine';
import { Core, acquireLeadership, onShutdown, startHeartbeat, startMetricsServer } from '@gocrypto/server-core';
import { OrderAdmissionService } from './admission';
import { InsuranceUnwinder } from './insurance';
import { LiquidationEngine } from './liquidation';

async function main(): Promise<void> {
  const core = await Core.create('risk-engine');
  const releaseLeadership = await acquireLeadership(core, 'risk-engine', () => process.exit(1));
  const gateway = await new RedisEngineGateway(core).start();
  const liquidations = new LiquidationEngine(core, gateway);
  await liquidations.start();
  const unwinder = new InsuranceUnwinder(core, new OrderAdmissionService(core, gateway));
  unwinder.start();
  const stats = () => ({ trackedAccounts: liquidations.trackedAccounts });
  const stopHeartbeat = startHeartbeat(core, 'risk-engine', stats);
  const metricsServer = startMetricsServer(core.config.METRICS_PORT || 9102, async () => stats());

  onShutdown(core, async () => {
    liquidations.stop();
    unwinder.stop();
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
