import { D } from '@gocrypto/trading-utils';
import { AlreadyProcessedError, BookDesyncError, OrderBook } from '@gocrypto/matching-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, api, assertLedgerReconciles, assertSpotLocksMatchOrders, balance, createUser, setPrice, startHarness } from './harness';

/**
 * Critical financial guarantees: no double spend, no duplicate orders/trades/withdrawals/liquidations,
 * atomic rollback, and a ledger that always reconciles with balances.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await setPrice(h, 'BTC', '50000');
});
afterAll(async () => {
  await assertLedgerReconciles(h);
  await h.close();
});

describe('concurrency & double-spend protection', () => {
  it('accepts exactly as many concurrent orders as the balance allows', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '1000']]);
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        api(h, 'POST', '/api/v1/spot/orders', { token: u.token, body: { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '10000', quantity: '0.01' } }),
      ),
    );
    const ok = results.filter((r) => r.statusCode === 201);
    const rejected = results.filter((r) => r.statusCode === 422);
    expect(ok).toHaveLength(10); // 10 x 100 USDT
    expect(rejected).toHaveLength(15);
    expect(rejected.every((r) => r.json().error.code === 'INSUFFICIENT_BALANCE')).toBe(true);
    const b = await balance(h, u.id, 'USDT');
    expect(b.available.toFixed()).toBe('0');
    expect(b.locked.toFixed()).toBe('1000');
    await assertSpotLocksMatchOrders(h, u.id, 'USDT');
  });

  it('prevents duplicate orders with the same clientOrderId under concurrency', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '100000']]);
    const body = { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '10000', quantity: '0.01', clientOrderId: 'dup-test-1' };
    const results = await Promise.all(Array.from({ length: 10 }, () => api(h, 'POST', '/api/v1/spot/orders', { token: u.token, body })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.json().error?.code === 'DUPLICATE_ORDER')).toHaveLength(9);
    expect((await balance(h, u.id, 'USDT')).locked.toFixed()).toBe('100');
  });

  it('replays Idempotency-Key requests instead of executing them twice', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '100000']]);
    const headers = { 'idempotency-key': 'idem-key-123456' };
    const body = { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '10000', quantity: '0.02' };
    const first = await api(h, 'POST', '/api/v1/spot/orders', { token: u.token, body, headers });
    const second = await api(h, 'POST', '/api/v1/spot/orders', { token: u.token, body, headers });
    expect(first.statusCode).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json().order.id).toBe(first.json().order.id);
    const count = await h.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?', [u.id]);
    expect(Number(count!.c)).toBe(1);
  });

  it('never fills more than a maker has when takers race for it', async () => {
    const maker = await createUser(h, [['SPOT', 'BTC', '0.1']]);
    await api(h, 'POST', '/api/v1/spot/orders', { token: maker.token, body: { symbol: 'BTCUSDT', side: 'SELL', type: 'LIMIT', price: '49000', quantity: '0.1' } });
    const takers = await Promise.all(Array.from({ length: 8 }, () => createUser(h, [['SPOT', 'USDT', '10000']])));
    await Promise.all(
      takers.map((t) =>
        api(h, 'POST', '/api/v1/spot/orders', { token: t.token, body: { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '49000', quantity: '0.05', timeInForce: 'IOC' } }),
      ),
    );
    const filled = await h.core.db.one<{ s: string }>(
      "SELECT SUM(quantity) AS s FROM order_fills WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?) ",
      [maker.id],
    );
    expect(D(filled!.s).toFixed()).toBe('0.1');
    expect((await balance(h, maker.id, 'BTC')).locked.toFixed()).toBe('0');
  });
});

describe('duplicate trade prevention & rollback', () => {
  it('refuses to settle the same match twice', async () => {
    const s = await createUser(h, [['SPOT', 'BTC', '1']]);
    const b = await createUser(h, [['SPOT', 'USDT', '100000']]);
    const ask = (await api(h, 'POST', '/api/v1/spot/orders', { token: s.token, body: { symbol: 'BTCUSDT', side: 'SELL', type: 'LIMIT', price: '48000', quantity: '0.1' } })).json().order;
    const bid = (await api(h, 'POST', '/api/v1/spot/orders', { token: b.token, body: { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '48000', quantity: '0.1' } })).json();
    expect(bid.order.status).toBe('FILLED');
    const before = { s: await balance(h, s.id, 'USDT'), b: await balance(h, b.id, 'BTC') };
    const market = h.core.markets.require('BTCUSDT');
    // Re-run settlement with a forged copy of the same match.
    const replay = new OrderBook({ symbol: 'BTCUSDT', tickSize: market.tickSize, stepSize: market.stepSize });
    replay.restore({ id: ask.id, userId: s.id, side: 'SELL', price: D('48000'), remaining: D('0.1'), seq: 1 });
    const result = replay.match({ id: bid.order.id, userId: b.id, side: 'BUY', kind: 'LIMIT', price: D('48000'), quantity: D('0.1'), timeInForce: 'GTC' });
    await expect(h.runner.settlement.settleMatch({ market, takerId: bid.order.id, takerQty: D('0.1'), result })).rejects.toBeInstanceOf(AlreadyProcessedError);
    // Forged taker id with the already-filled maker: maker is not open -> desync, nothing written.
    const fresh = await h.core.db.execute(
      `INSERT INTO orders (user_id, market_id, market_type, client_order_id, side, type, status, price, quantity, lock_asset_id, locked_amount)
       VALUES (?, ?, 'SPOT', 'forged-1', 'BUY', 'LIMIT', 'NEW', '48000', '0.1', ?, 0)`,
      [b.id, market.id, market.quoteAssetId],
    );
    const forged = replay.match({ id: fresh.insertId, userId: b.id, side: 'BUY', kind: 'LIMIT', price: D('48000'), quantity: D('0.1'), timeInForce: 'GTC' });
    void forged;
    const replay2 = new OrderBook({ symbol: 'BTCUSDT', tickSize: market.tickSize, stepSize: market.stepSize });
    replay2.restore({ id: ask.id, userId: s.id, side: 'SELL', price: D('48000'), remaining: D('0.1'), seq: 1 });
    const r2 = replay2.match({ id: fresh.insertId, userId: b.id, side: 'BUY', kind: 'LIMIT', price: D('48000'), quantity: D('0.1'), timeInForce: 'GTC' });
    await expect(h.runner.settlement.settleMatch({ market, takerId: fresh.insertId, takerQty: D('0.1'), result: r2 })).rejects.toBeInstanceOf(BookDesyncError);
    expect((await balance(h, s.id, 'USDT')).available.eq(before.s.available)).toBe(true);
    expect((await balance(h, b.id, 'BTC')).available.eq(before.b.available)).toBe(true);
    const trades = await h.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM trades WHERE maker_order_id = ?', [ask.id]);
    expect(Number(trades!.c)).toBe(1);
  });

  it('rolls back the whole transaction when any step fails', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '50']]);
    const usdt = h.core.assets.require('USDT');
    await expect(
      h.core.db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO orders (user_id, market_id, market_type, client_order_id, side, type, price, quantity, lock_asset_id, locked_amount)
           VALUES (?, ?, 'SPOT', 'rollback-1', 'BUY', 'LIMIT', '100', '1', ?, '100')`,
          [u.id, h.core.markets.require('BTCUSDT').id, usdt.id],
        );
        await h.core.wallet.apply(tx, [{ userId: u.id, assetId: usdt.id, account: 'SPOT', available: '-100', locked: '100', type: 'ORDER_LOCK' }]);
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    const o = await h.core.db.one<{ c: number }>("SELECT COUNT(*) AS c FROM orders WHERE client_order_id = 'rollback-1'");
    expect(Number(o!.c)).toBe(0);
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('50');
  });

  it('enforces non-negative balances at the database level too', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '10']]);
    const usdt = h.core.assets.require('USDT');
    await expect(
      h.core.db.execute("UPDATE wallets SET available = available - 11 WHERE user_id = ? AND asset_id = ? AND account_type = 'SPOT'", [u.id, usdt.id]),
    ).rejects.toBeTruthy();
  });
});

describe('withdrawal safety', () => {
  async function withdrawer(amount: string) {
    const u = await createUser(h, [['SPOT', 'USDT', amount]]);
    await api(h, 'POST', '/api/v1/auth/pin', { token: u.token, body: { pin: '480913', password: u.password } });
    await h.core.settings.set(h.core.db, 'withdrawal.require_email_code', false, null);
    await h.core.db.execute('UPDATE users SET kyc_level = 2 WHERE id = ?', [u.id]);
    h.core.users.invalidate(u.id);
    return u;
  }

  it('allows only one of two concurrent withdrawals that together exceed the balance', async () => {
    const u = await withdrawer('1000');
    const body = (key: string) => ({ asset: 'USDT', network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '700', pin: '480913', idempotencyKey: key });
    const [a, b] = await Promise.all([
      api(h, 'POST', '/api/v1/wallet/withdrawals', { token: u.token, body: body('withdraw-aaaa-1') }),
      api(h, 'POST', '/api/v1/wallet/withdrawals', { token: u.token, body: body('withdraw-bbbb-2') }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 422]);
    const bal = await balance(h, u.id, 'USDT');
    expect(bal.available.toFixed()).toBe('300');
    expect(bal.locked.toFixed()).toBe('700');
  });

  it('creates a single withdrawal for concurrent requests with the same idempotency key', async () => {
    const u = await withdrawer('1000');
    const body = { asset: 'USDT', network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '100', pin: '480913', idempotencyKey: 'same-key-123456' };
    const results = await Promise.all(Array.from({ length: 5 }, () => api(h, 'POST', '/api/v1/wallet/withdrawals', { token: u.token, body })));
    const ids = new Set(results.filter((r) => r.statusCode === 201).map((r) => r.json().id));
    expect(ids.size).toBe(1);
    const rows = await h.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ?', [u.id]);
    expect(Number(rows!.c)).toBe(1);
    expect((await balance(h, u.id, 'USDT')).locked.toFixed()).toBe('100');
  });

  it('processes, rejects and cancels withdrawals with exactly-once balance effects', async () => {
    const u = await withdrawer('1000');
    const w = (await api(h, 'POST', '/api/v1/wallet/withdrawals', {
      token: u.token,
      body: { asset: 'USDT', network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '200', pin: '480913', idempotencyKey: 'process-key-0001' },
    })).json();
    const [s1, s2] = await Promise.all([h.core.walletOps.processWithdrawal(w.id), h.core.walletOps.processWithdrawal(w.id)]);
    expect([s1, s2]).toContain('COMPLETED');
    const bal = await balance(h, u.id, 'USDT');
    expect(bal.available.toFixed()).toBe('800');
    expect(bal.locked.toFixed()).toBe('0');
    expect((await balance(h, h.core.users.systemIds.feeCollector, 'USDT')).available.gte(1)).toBe(true);
    // Invalid address is rejected before anything is locked.
    const bad = await api(h, 'POST', '/api/v1/wallet/withdrawals', {
      token: u.token,
      body: { asset: 'USDT', network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u', amount: '50', pin: '480913', idempotencyKey: 'bad-address-001' },
    });
    expect(bad.json().error.code).toBe('INVALID_ADDRESS');
    // Large withdrawals go to manual review; rejection returns the funds once.
    await h.core.settings.set(h.core.db, 'withdrawal.review_threshold_usd', '100', null);
    const big = (await api(h, 'POST', '/api/v1/wallet/withdrawals', {
      token: u.token,
      body: { asset: 'USDT', network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '300', pin: '480913', idempotencyKey: 'review-key-0001' },
    })).json();
    expect(big.status).toBe('PENDING_REVIEW');
    await h.core.walletOps.reviewWithdrawal(h.core.users.systemIds.feeCollector, big.id, 'REJECT', 'test');
    await expect(h.core.walletOps.reviewWithdrawal(h.core.users.systemIds.feeCollector, big.id, 'REJECT', 'again')).rejects.toBeTruthy();
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('800');
    await h.core.settings.set(h.core.db, 'withdrawal.review_threshold_usd', '10000', null);
  });
});

describe('deposits', () => {
  it('credits a deposit exactly once even if confirmations are processed twice', async () => {
    const u = await createUser(h);
    const dep = (await api(h, 'POST', '/api/v1/wallet/deposits/simulate', { token: u.token, body: { asset: 'USDT', network: 'TRC20', amount: '250' } })).json();
    await Promise.all([h.core.walletOps.confirmDeposit(dep.id, 10), h.core.walletOps.confirmDeposit(dep.id, 10), h.core.walletOps.confirmDeposit(dep.id, 10)]);
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('250');
    const ingested = await h.core.walletOps.ingestDeposit({ network: 'TRC20', txHash: 'abc', address: dep.address, asset: 'USDT', amount: '1' });
    const again = await h.core.walletOps.ingestDeposit({ network: 'TRC20', txHash: 'abc', address: dep.address, asset: 'USDT', amount: '1' });
    expect(ingested).toBeTruthy();
    expect(again).toBeNull();
  });
});
