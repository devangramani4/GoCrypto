import http from 'node:http';
import { Core, onShutdown, renderMetrics, startHeartbeat } from '@gocrypto/server-core';
import { WsGateway } from './gateway';

async function main(): Promise<void> {
  const core = await Core.create('websocket');
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', connections: gateway.connections }));
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
  server.listen(core.config.WS_PORT, () => core.log.info({ port: core.config.WS_PORT, path: core.config.WS_PATH }, 'websocket gateway listening'));
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
