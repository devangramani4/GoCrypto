import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeed } from '@gocrypto/database/seed';
import { EngineRunner, InProcessEngineGateway } from '@gocrypto/matching-engine';
import { OrderAdmissionService } from '@gocrypto/risk-engine';
import {
  Core,
  Database,
  type MarkPriceDto,
  PriceService,
  hashPassword,
  loadConfig,
  migrateDown,
  migrateUp,
} from '@gocrypto/server-core';
import type { AccountType } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations');

export interface TestUser {
  id: string;
  email: string;
  password: string;
  token: string;
  sessionId: string;
  refreshToken: string;
}

export interface Harness {
  core: Core;
  runner: EngineRunner;
  engine: InProcessEngineGateway;
  admission: OrderAdmissionService;
  app: FastifyInstance;
  close(): Promise<void>;
}

let userSeq = 0;

/** Fresh schema + seed + in-process engine + Fastify app for one test file. */
export async function startHarness(): Promise<Harness> {
  const cfg = loadConfig();
  const db = Database.connect(cfg.DATABASE_URL, 2);
  await migrateDown(db, migrations, 1000);
  await migrateUp(db, migrations);
  await db.close();
  const core = await Core.create('test', { watchConfig: false, poolSize: 40 });
  await core.redis.main.flushdb();
  await runSeed(core, { demoUser: false });
  const runner = new EngineRunner(core, { depthIntervalMs: 20, sweepIntervalMs: 3_600_000 });
  await runner.start();
  const engine = new InProcessEngineGateway(runner);
  const admission = new OrderAdmissionService(core, engine);
  const app = await buildApp({ core, engine, admission, runner }, { rateLimit: false, docs: false });
  await app.ready();
  return {
    core,
    runner,
    engine,
    admission,
    app,
    async close() {
      await app.close();
      await runner.stop();
      await core.close();
    },
  };
}

export async function api(
  h: Harness,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON bodies keep assertions terse
): Promise<LightMyRequestResponse & { body: string; json: <T = any>() => T }> {
  const res = await h.app.inject({
    method,
    url,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      'x-device-id': 'test-device-0001',
      'user-agent': 'vitest',
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return res as never;
}

/** Create a user directly (fast) with balances, then log in through the API. */
export async function createUser(
  h: Harness,
  balances: [AccountType, string, string][] = [],
  opts: { role?: string; emailVerified?: boolean; email?: string } = {},
): Promise<TestUser> {
  userSeq += 1;
  const email = opts.email ?? `user${userSeq}-${Date.now()}@test.gocrypto`;
  const password = 'Sup3rSecretPass!';
  const id = await h.core.users.createUser(h.core.db, {
    email,
    passwordHash: await hashPassword(password),
    role: (opts.role ?? 'USER') as never,
    emailVerified: opts.emailVerified ?? true,
  });
  await credit(h, id, balances);
  const res = await api(h, 'POST', '/api/v1/auth/login', { body: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const body = res.json();
  return {
    id,
    email,
    password,
    token: body.tokens.accessToken,
    sessionId: body.tokens.sessionId,
    refreshToken: body.tokens.refreshToken,
  };
}

export async function credit(h: Harness, userId: string, balances: [AccountType, string, string][]): Promise<void> {
  for (const [account, asset, amount] of balances) {
    const a = h.core.assets.require(asset);
    await h.core.db.transaction((tx) =>
      h.core.wallet.apply(tx, [
        { userId, assetId: a.id, account, available: amount, type: 'ADJUSTMENT', refType: 'TEST' },
      ]),
    );
  }
}

export async function balance(h: Harness, userId: string, asset: string, account: AccountType = 'SPOT') {
  const w = await h.core.wallet.getWallet(h.core.db, { userId, assetId: h.core.assets.require(asset).id, account });
  return { available: w?.available ?? D(0), locked: w?.locked ?? D(0) };
}

/** Publish index (+ mark for perps on that underlying) prices into Redis. */
export async function setPrice(h: Harness, asset: string, price: string, markOverride?: string): Promise<void> {
  await h.core.redis.main.set(PriceService.indexKey(asset), price);
  h.core.prices.clearUsdCache();
  for (const m of h.core.markets.list('FUTURES')) {
    if (m.futures?.underlying !== asset) continue;
    const dto: MarkPriceDto = {
      symbol: m.symbol,
      markPrice: markOverride ?? price,
      indexPrice: price,
      fundingRate: '0.0001',
      nextFundingTime: Date.now() + 3_600_000,
      ts: Date.now(),
    };
    await h.core.redis.main.set(PriceService.markKey(m.symbol), JSON.stringify(dto));
  }
}

export async function flushBooks(h: Harness): Promise<void> {
  await h.runner.idle();
  await h.runner.publishDepth();
}

/** Every wallet balance must equal the sum of its ledger entries (double-entry style reconciliation). */
export async function assertLedgerReconciles(h: Harness): Promise<void> {
  const rows = await h.core.db.query<{
    id: string;
    available: string;
    locked: string;
    la: string | null;
    ll: string | null;
  }>(
    `SELECT w.id, w.available, w.locked, SUM(t.available_delta) AS la, SUM(t.locked_delta) AS ll
       FROM wallets w LEFT JOIN wallet_transactions t ON t.wallet_id = w.id GROUP BY w.id`,
  );
  for (const r of rows) {
    if (!D(r.available).eq(D(r.la ?? 0)) || !D(r.locked).eq(D(r.ll ?? 0))) {
      throw new Error(
        `wallet ${r.id} does not reconcile: balance ${r.available}/${r.locked} vs ledger ${r.la}/${r.ll}`,
      );
    }
    if (D(r.available).isNegative() || D(r.locked).isNegative()) throw new Error(`wallet ${r.id} is negative`);
  }
}

/** Locked balances must equal the reservations held by open orders (+ withdrawals and margins). */
export async function assertSpotLocksMatchOrders(h: Harness, userId: string, asset: string): Promise<void> {
  const a = h.core.assets.require(asset);
  const w = await balance(h, userId, asset);
  const r = await h.core.db.one<{ s: string | null }>(
    "SELECT SUM(locked_amount) AS s FROM orders WHERE user_id = ? AND market_type = 'SPOT' AND lock_asset_id = ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
    [userId, a.id],
  );
  const wd = await h.core.db.one<{ s: string | null }>(
    "SELECT SUM(amount) AS s FROM withdrawals WHERE user_id = ? AND asset_id = ? AND status IN ('PENDING_REVIEW','APPROVED','PROCESSING')",
    [userId, a.id],
  );
  const expected = D(r?.s ?? 0).plus(wd?.s ?? 0);
  if (!w.locked.eq(expected))
    throw new Error(`locked ${w.locked.toFixed()} != reserved ${expected.toFixed()} for ${asset}`);
}
