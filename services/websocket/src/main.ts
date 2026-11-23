import http from 'node:http';
import { Core, onShutdown, renderMetrics, startHeartbeat } from '@gocrypto/server-core';
import { WsGateway } from './gateway';

async function main(): Promise<void> {
  const core = await Core.create('websocket');
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/ready') {
      // /health = liveness (never fails under load: restarting a busy gateway causes a reconnect storm);
      // /ready = admission, 503 while the node is full or lagging so the load balancer routes new clients away.
      const admitting = gateway.admitting;
      const body = {
        status: admitting ? 'ok' : 'busy',
        connections: gateway.connections,
        redisSubscriptions: gateway.redisSubscriptions,
        loopDelayP99Ms: Math.round(gateway.loopDelayP99Ms),
        cpuCores: Math.round(gateway.cpuCores * 100) / 100,
        backlogChannels: gateway.backlog,
      };
      res
        .writeHead(req.url === '/ready' && !admitting ? 503 : 200, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
      return;
    }
    if (req.url === '/metrics') {
      if (core.config.METRICS_TOKEN && req.headers.authorization !== `Bearer ${core.config.METRICS_TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const m = await renderMetrics();
      res.writeHead(200, { 'content-type': m.contentType }).end(m.body);
      return;
    }
    res.writeHead(404).end();
  });
  const gateway = new WsGateway(core, server);
  await gateway.start();
  // A deep accept queue absorbs reconnect storms (a gateway restart sends all its clients to the others);
  // the kernel caps it at net.core.somaxconn.
  server.listen({ port: core.config.WS_PORT, backlog: 4096 }, () =>
    core.log.info({ port: core.config.WS_PORT, path: core.config.WS_PATH }, 'websocket gateway listening'),
  );
  const stopHeartbeat = startHeartbeat(core, 'websocket', () => ({ connections: gateway.connections }));
  onShutdown(core, async () => {
    stopHeartbeat();
    await gateway.close();
    server.close();
    await core.close();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
