/**
 * Mixed-scenario load generator.
 *
 *   pnpm --filter @gocrypto/loadtest run -- --users users.json --duration 120 --ramp 30 \
 *     --viewers 5000 --readers 300 --accounts 300 --traders 300 --logins 5
 *
 * Virtual user types (all run concurrently, ramped linearly over --ramp seconds):
 *   viewers   WebSocket market-data users (Socket.IO wire protocol over the built-in WebSocket client;
 *             ~30% authenticated so private channels are exercised). Measures publish→delivery lag.
 *   readers   HTTP market-data users: tickers, order book, trades, candles (think time --readerThink ms).
 *   accounts  HTTP account users: balances, open orders, positions, portfolio (think time --accountThink).
 *   traders   place spot/futures limit orders around the mid (30% marketable), cancel most resting ones.
 *   logins    password logins per second (Argon2 path) using the seeded password.
 *
 * Each virtual user presents its own client IP (X-Forwarded-For) like traffic arriving through the edge
 * proxy — run the API with TRUST_PROXY=true. For multi-million-user tests run this on many machines
 * (each with its own users file / user range) against a scaled deployment.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'undici';
import { Metrics } from './metrics';

// ───────────────────────── config ─────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const API = arg('api', 'http://127.0.0.1:4000');
const WS = arg('ws', 'http://127.0.0.1:4001');
const DURATION = Number(arg('duration', '60')) * 1000;
const RAMP = Number(arg('ramp', '20')) * 1000;
const N_VIEWERS = Number(arg('viewers', '1000'));
const N_READERS = Number(arg('readers', '100'));
const N_ACCOUNTS = Number(arg('accounts', '100'));
const N_TRADERS = Number(arg('traders', '100'));
const LOGINS_PER_SEC = Number(arg('logins', '0'));
const READER_THINK = Number(arg('readerThink', '1000'));
const ACCOUNT_THINK = Number(arg('accountThink', '2000'));
const TRADER_THINK = Number(arg('traderThink', '1000'));
const OFFSET = Number(arg('userOffset', '0'));
const SYMBOLS = arg('symbols', 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,BTCUSDT-PERP,ETHUSDT-PERP,SOLUSDT-PERP').split(
  ',',
);
const OUT = arg('out', '');
const CONNECTIONS = Number(arg('connections', '512'));

const seeded = JSON.parse(readFileSync(arg('users', 'users.json'), 'utf8')) as {
  password: string;
  users: { id: string; email: string; accessToken: string }[];
};
const users = seeded.users.slice(OFFSET);
const metrics = new Metrics();
const pool = new Pool(API, { connections: CONNECTIONS, pipelining: 1, keepAliveTimeout: 30_000 });
let stopping = false;
const started = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms * (0.5 + Math.random());
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
/** Zipf-ish symbol popularity: BTC and ETH dominate like on real exchanges. */
const pickSymbol = () => SYMBOLS[Math.min(SYMBOLS.length - 1, Math.floor(Math.random() ** 2.2 * SYMBOLS.length))]!;
/** CLI output (stdout), one line per call. */
const say = (line: string) => process.stdout.write(`${line}\n`);
const fakeIp = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

// ───────────────────────── HTTP ─────────────────────────

interface Res {
  status: number;
  json: unknown;
}

async function http(
  op: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  opts: { token?: string; ip: string; body?: unknown; idempotent?: boolean },
): Promise<Res | null> {
  const t = performance.now();
  try {
    const res = await pool.request({
      method,
      path,
      headers: {
        'x-forwarded-for': opts.ip,
        'user-agent': 'gocrypto-loadtest',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.idempotent ? { 'idempotency-key': randomUUID().replace(/-/g, '') } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
    });
    const text = await res.body.text();
    const ms = performance.now() - t;
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.statusCode >= 400) {
      const code = (json as { error?: { code?: string } } | null)?.error?.code ?? String(res.statusCode);
      metrics.stat(op).error(`${res.statusCode}:${code}`);
    } else metrics.stat(op).record(ms);
    return { status: res.statusCode, json };
  } catch (e) {
    metrics.stat(op).error((e as { code?: string }).code ?? (e as Error).name);
    return null;
  }
}

// ───────────────────────── shared market state ─────────────────────────

interface MarketInfo {
  symbol: string;
  type: string;
  tickSize: string;
  stepSize: string;
  minQty: string;
  minNotional: string;
}
const markets = new Map<string, MarketInfo>();
const mids = new Map<string, number>();

async function refreshTickers(): Promise<void> {
  for (const type of ['SPOT', 'FUTURES']) {
    const r = await http('public.tickers.refresh', 'GET', `/api/v1/markets/tickers?type=${type}`, {
      ip: '10.255.255.254',
    });
    for (const t of (r?.json as { symbol: string; lastPrice: string }[] | null) ?? [])
      mids.set(t.symbol, Number(t.lastPrice));
  }
}

function decimals(step: string): number {
  const i = step.indexOf('.');
  return i === -1 ? 0 : step.replace(/0+$/, '').length - i - 1;
}
/** Display-precision rounding for request generation only (the server validates exactly). */
function roundTo(v: number, step: string, mode: 'floor' | 'ceil' | 'round' = 'round'): string {
  const s = Number(step);
  const n = mode === 'floor' ? Math.floor(v / s) : mode === 'ceil' ? Math.ceil(v / s) : Math.round(v / s);
  return (n * s).toFixed(decimals(step));
}

// ───────────────────────── virtual users ─────────────────────────

async function trader(i: number): Promise<void> {
  const u = users[i % users.length]!;
  const ip = fakeIp(100_000 + i);
  while (!stopping) {
    const symbol = pickSymbol();
    const m = markets.get(symbol);
    const mid = mids.get(symbol);
    if (!m || !mid) {
      await sleep(500);
      continue;
    }
    const side = Math.random() < 0.5 ? 'BUY' : 'SELL';
    const marketable = Math.random() < 0.3;
    const offset = (marketable ? 0.002 : -(0.0005 + Math.random() * 0.004)) * (side === 'BUY' ? 1 : -1);
    const price = roundTo(mid * (1 + offset), m.tickSize);
    const minByNotional = (Number(m.minNotional) * 1.5) / Number(price);
    const qty = roundTo(
      Math.max(Number(m.minQty), minByNotional) * (1 + Math.floor(Math.random() * 3)),
      m.stepSize,
      'ceil',
    );
    const futures = m.type === 'FUTURES';
    const r = await http(
      futures ? 'trade.futures.place' : 'trade.spot.place',
      'POST',
      futures ? '/api/v1/futures/orders' : '/api/v1/spot/orders',
      {
        token: u.accessToken,
        ip,
        idempotent: true,
        body: { symbol, side, type: 'LIMIT', price, quantity: qty, timeInForce: 'GTC' },
      },
    );
    const order = (r?.json as { order?: { id: string; status: string } } | null)?.order;
    if (order) {
      metrics.inc(`order.${order.status}`);
      if (
        (order.status === 'OPEN' || order.status === 'NEW' || order.status === 'PARTIALLY_FILLED') &&
        Math.random() < 0.8
      ) {
        const id = order.id;
        setTimeout(() => {
          if (!stopping) void http('trade.cancel', 'DELETE', `/api/v1/orders/${id}`, { token: u.accessToken, ip });
        }, jitter(3000));
      }
    }
    await sleep(jitter(TRADER_THINK));
  }
}

async function reader(i: number): Promise<void> {
  const u = users[(i + 7919) % users.length]!;
  const ip = fakeIp(200_000 + i);
  let step = 0;
  while (!stopping) {
    const symbol = pickSymbol();
    switch (step++ % 4) {
      case 0:
        await http(
          'public.tickers',
          'GET',
          `/api/v1/markets/tickers?type=${Math.random() < 0.7 ? 'SPOT' : 'FUTURES'}`,
          { token: u.accessToken, ip },
        );
        break;
      case 1:
        await http('public.orderbook', 'GET', `/api/v1/markets/${symbol}/orderbook?depth=50`, {
          token: u.accessToken,
          ip,
        });
        break;
      case 2:
        await http('public.trades', 'GET', `/api/v1/markets/${symbol}/trades?limit=50`, { token: u.accessToken, ip });
        break;
      default:
        await http(
          'public.candles',
          'GET',
          `/api/v1/markets/${symbol}/candles?interval=${pick(['1m', '15m', '1h'])}&limit=500`,
          { token: u.accessToken, ip },
        );
    }
    await sleep(jitter(READER_THINK));
  }
}

async function account(i: number): Promise<void> {
  const u = users[(i + 15_485) % users.length]!;
  const ip = fakeIp(300_000 + i);
  let step = 0;
  while (!stopping) {
    switch (step++ % 4) {
      case 0:
        await http('account.balances', 'GET', '/api/v1/wallet/balances?account=SPOT', { token: u.accessToken, ip });
        break;
      case 1:
        await http('account.openOrders', 'GET', '/api/v1/orders/open', { token: u.accessToken, ip });
        break;
      case 2:
        await http('account.positions', 'GET', '/api/v1/futures/positions', { token: u.accessToken, ip });
        break;
      default:
        await http('account.portfolio', 'GET', '/api/v1/portfolio/summary', { token: u.accessToken, ip });
    }
    await sleep(jitter(ACCOUNT_THINK));
  }
}

// Socket.IO v4 / Engine.IO v4 framing: "0" open, "2"/"3" ping/pong, "40" connect, "42" event, "43" ack.
let wsConnected = 0;
let wsMessages = 0;
let wsBytes = 0;
const sockets = new Set<WebSocket>();
const wsTypes = new Map<string, { n: number; bytes: number }>();

function viewer(i: number): void {
  const u = users[(i + 104_729) % users.length]!;
  const authed = i % 10 < 3;
  const symbol = pickSymbol();
  const channels = [`market:${symbol}:ticker`, `market:${symbol}:trades`];
  if (i % 4 === 0) channels.push(`market:${symbol}:orderbook`);
  if (i % 5 === 0) channels.push('market:all:tickers');
  const t0 = performance.now();
  const ws = new WebSocket(`${WS.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`);
  sockets.add(ws);
  let open = false;
  let failed = false;
  ws.onmessage = (ev: MessageEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : '';
    if (data === '2') return ws.send('3');
    if (data.startsWith('0')) return ws.send(authed ? `40${JSON.stringify({ token: u.accessToken })}` : '40');
    if (data.startsWith('40')) {
      open = true;
      wsConnected += 1;
      metrics.stat('ws.connect').record(performance.now() - t0);
      return ws.send(`420${JSON.stringify(['subscribe', { channels }])}`);
    }
    if (data.startsWith('44')) return metrics.stat('ws.connect').error('connect_error');
    if (data.startsWith('42')) {
      wsMessages += 1;
      wsBytes += data.length;
      // Per event type message/byte mix (`"type":"orderbook"` follows the channel in the envelope).
      const ti = data.indexOf('"type":"');
      if (ti !== -1) {
        const type = data.slice(ti + 8, data.indexOf('"', ti + 8));
        const t = wsTypes.get(type) ?? { n: 0, bytes: 0 };
        t.n += 1;
        t.bytes += data.length;
        wsTypes.set(type, t);
      }
      // Sample 2% of frames for end-to-end publish→delivery lag (keeps the generator's CPU for sockets).
      if (Math.random() < 0.02) {
        const m = /"ts":(\d{13})/.exec(data.slice(-40)) ?? /"ts":(\d{13})/.exec(data);
        if (m) metrics.stat('ws.lag').record(Date.now() - Number(m[1]));
      }
    }
  };
  ws.onerror = (ev: Event) => {
    // One failure per connection attempt (the client can report a refused handshake twice).
    if (open || failed) return;
    failed = true;
    // Keep the failure reason (handshake status, ECONNRESET, timeout...) in the report.
    const err = ev as Event & { message?: string; error?: { cause?: { code?: string }; message?: string } };
    const reason = err.error?.cause?.code ?? err.error?.message ?? err.message ?? 'error';
    metrics.stat('ws.connect').error(String(reason).slice(0, 80));
  };
  ws.onclose = () => {
    sockets.delete(ws);
    if (open) {
      wsConnected -= 1;
      if (!stopping) metrics.inc('ws.dropped');
    }
  };
}

let loginIdx = 0;
async function loginStorm(): Promise<void> {
  if (!LOGINS_PER_SEC) return;
  const interval = 1000 / LOGINS_PER_SEC;
  while (!stopping) {
    const u = users[loginIdx++ % users.length]!;
    void http('auth.login', 'POST', '/api/v1/auth/login', {
      ip: fakeIp(400_000 + loginIdx),
      body: { email: u.email, password: seeded.password },
    });
    await sleep(interval);
  }
}

// ───────────────────────── orchestration ─────────────────────────

function progress(): void {
  const el = (Date.now() - started) / 1000;
  const s = metrics.snapshot(el);
  const line = (k: string) => {
    const o = s.ops[k];
    return o ? `${k} ${o.rate}/s p95=${o.p95}ms err=${o.errors}` : '';
  };
  say(
    `[${Math.round(el)}s] ws=${wsConnected} msgs/s≈${Math.round(wsMessages / el)} | ` +
      ['trade.spot.place', 'trade.futures.place', 'public.orderbook', 'account.balances', 'auth.login', 'ws.lag']
        .map(line)
        .filter(Boolean)
        .join(' | '),
  );
}

async function main(): Promise<void> {
  const list = (await http('public.markets', 'GET', '/api/v1/markets', { ip: '10.255.255.253' }))?.json as
    MarketInfo[] | null;
  for (const m of list ?? []) if (SYMBOLS.includes(m.symbol)) markets.set(m.symbol, m);
  await refreshTickers();
  say(
    `markets=${markets.size} users=${users.length} viewers=${N_VIEWERS} readers=${N_READERS} accounts=${N_ACCOUNTS} traders=${N_TRADERS} logins/s=${LOGINS_PER_SEC}`,
  );
  const tickerTimer = setInterval(() => void refreshTickers(), 1000);
  const progressTimer = setInterval(progress, 5000);

  const tasks: Promise<void>[] = [];
  const total = N_VIEWERS + N_READERS + N_ACCOUNTS + N_TRADERS;
  const spacing = total > 0 ? RAMP / total : 0;
  let v = 0;
  let r = 0;
  let a = 0;
  let t = 0;
  tasks.push(loginStorm());
  for (let k = 0; k < total && !stopping; k++) {
    // Interleave user types so every type ramps up together.
    const slot = k % 4;
    if (slot === 0 && v < N_VIEWERS) viewer(v++);
    else if (slot === 1 && r < N_READERS) tasks.push(reader(r++));
    else if (slot === 2 && a < N_ACCOUNTS) tasks.push(account(a++));
    else if (slot === 3 && t < N_TRADERS) tasks.push(trader(t++));
    else if (v < N_VIEWERS) viewer(v++);
    else if (r < N_READERS) tasks.push(reader(r++));
    else if (a < N_ACCOUNTS) tasks.push(account(a++));
    else if (t < N_TRADERS) tasks.push(trader(t++));
    if (spacing >= 1) await sleep(spacing);
    else if (k % Math.max(1, Math.round(1 / Math.max(spacing, 0.001))) === 0) await sleep(1);
  }
  await sleep(Math.max(0, DURATION - (Date.now() - started)));
  stopping = true;
  clearInterval(tickerTimer);
  clearInterval(progressTimer);
  const elapsed = (Date.now() - started) / 1000;
  metrics.gauge('ws.connectedAtEnd', wsConnected);
  metrics.gauge('ws.messages', wsMessages);
  metrics.gauge('ws.messagesPerSec', Math.round(wsMessages / elapsed));
  metrics.gauge('ws.mbPerSec', Math.round((wsBytes / elapsed / 1e6) * 10) / 10);
  for (const [type, t] of wsTypes) {
    metrics.gauge(`ws.type.${type}.perSec`, Math.round(t.n / elapsed));
    metrics.gauge(`ws.type.${type}.avgBytes`, Math.round(t.bytes / Math.max(1, t.n)));
  }
  for (const ws of sockets) ws.close();
  await Promise.race([Promise.allSettled(tasks), sleep(10_000)]);
  const report = metrics.snapshot(elapsed);
  say(JSON.stringify(report, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  await pool.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
