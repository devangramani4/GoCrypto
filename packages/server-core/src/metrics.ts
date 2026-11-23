import http from 'node:http';
import client from 'prom-client';
import { loadConfig } from './config';
import { getLogger } from './logger';

/** Process-wide Prometheus registry. */
export const registry = new client.Registry();
let defaultsCollected = false;

export function initMetrics(service: string): void {
  if (defaultsCollected) return;
  defaultsCollected = true;
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry, prefix: 'gocrypto_' });
}

function counter(name: string, help: string, labelNames: string[] = []) {
  return new client.Counter({ name, help, labelNames, registers: [registry] });
}
function gauge(name: string, help: string, labelNames: string[] = []) {
  return new client.Gauge({ name, help, labelNames, registers: [registry] });
}
function histogram(name: string, help: string, labelNames: string[], buckets: number[]) {
  return new client.Histogram({ name, help, labelNames, buckets, registers: [registry] });
}

export const metrics = {
  httpDuration: histogram(
    'gocrypto_http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'route', 'status'],
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  ),
  ordersTotal: counter('gocrypto_orders_total', 'Orders accepted/rejected by the risk engine', ['market_type', 'type', 'result']),
  tradesTotal: counter('gocrypto_trades_total', 'Trades executed by the matching engine', ['market_type']),
  engineCommandDuration: histogram(
    'gocrypto_engine_command_duration_seconds',
    'Matching engine command processing time (match + settle)',
    ['command'],
    [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  ),
  engineQueueDepth: gauge('gocrypto_engine_queue_depth', 'Pending engine commands per market', ['symbol']),
  bookDepth: gauge('gocrypto_orderbook_orders', 'Resting orders in the in-memory book', ['symbol']),
  settlementFailures: counter('gocrypto_settlement_failures_total', 'Settlement transactions that failed', ['market_type']),
  wsConnections: gauge('gocrypto_ws_connections', 'Open websocket connections'),
  wsMessages: counter('gocrypto_ws_messages_total', 'Websocket messages fanned out', ['scope']),
  wsSubscriptions: gauge('gocrypto_ws_subscriptions', 'Active websocket channel subscriptions'),
  liquidationsTotal: counter('gocrypto_liquidations_total', 'Positions liquidated', ['margin_mode']),
  liquidationChecks: counter('gocrypto_liquidation_checks_total', 'Account risk evaluations performed'),
  fundingPayments: counter('gocrypto_funding_payments_total', 'Funding payments settled'),
  withdrawalsTotal: counter('gocrypto_withdrawals_total', 'Withdrawals by final status', ['status']),
  depositsTotal: counter('gocrypto_deposits_total', 'Deposits credited'),
  jobsTotal: counter('gocrypto_jobs_total', 'Background jobs processed', ['queue', 'result']),
  marketDataTicks: counter('gocrypto_market_data_ticks_total', 'Index price updates received', ['source']),
  authEvents: counter('gocrypto_auth_events_total', 'Authentication events', ['event']),
  dbPoolInUse: gauge('gocrypto_db_pool_in_use', 'Active MySQL connections'),
};

export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}

/** Minimal /metrics + /health HTTP server for non-HTTP services (engine, workers, market-data). */
export function startMetricsServer(port: number, health: () => Promise<Record<string, unknown>> = async () => ({})): http.Server | null {
  if (!port) return null;
  const token = loadConfig().METRICS_TOKEN;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/health') {
        const body = JSON.stringify({ status: 'ok', ...(await health()) });
        res.writeHead(200, { 'content-type': 'application/json' }).end(body);
        return;
      }
      if (req.url === '/metrics') {
        if (token && req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401).end();
          return;
        }
        const m = await renderMetrics();
        res.writeHead(200, { 'content-type': m.contentType }).end(m.body);
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  server.listen(port, () => getLogger().info({ port }, 'metrics server listening'));
  return server;
}
