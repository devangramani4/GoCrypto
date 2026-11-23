import { sweepFeeAccruals } from '@gocrypto/server-core';
import { D } from '@gocrypto/trading-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TriggerMonitor } from '../../workers/src/triggers';
import {
  type Harness,
  api,
  assertLedgerReconciles,
  assertSpotLocksMatchOrders,
  balance,
  createUser,
  flushBooks,
  setPrice,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await setPrice(h, 'BTC', '50000');
  await setPrice(h, 'ETH', '3000');
});
afterAll(async () => {
  await assertLedgerReconciles(h);
  await h.close();
});

const order = (token: string, body: Record<string, unknown>) => api(h, 'POST', '/api/v1/spot/orders', { token, body });

describe('spot matching & settlement', () => {
  it('matches with price-time priority, applies maker/taker fees and conserves balances', async () => {
    const m1 = await createUser(h, [['SPOT', 'BTC', '1']]);
    const m2 = await createUser(h, [['SPOT', 'BTC', '1']]);
    const t = await createUser(h, [['SPOT', 'USDT', '100000']]);
    // Two asks at the same price: m1 first.
    expect(
      (
        await order(m1.token, { symbol: 'BTCUSDT', side: 'SELL', type: 'LIMIT', price: '50000', quantity: '0.5' })
      ).json().order.status,
    ).toBe('OPEN');
    expect(
      (
        await order(m2.token, { symbol: 'BTCUSDT', side: 'SELL', type: 'LIMIT', price: '50000', quantity: '0.5' })
      ).json().order.status,
    ).toBe('OPEN');
    const r = (
      await order(t.token, { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '50100', quantity: '0.7' })
    ).json();
    expect(r.order.status).toBe('FILLED');
    expect(r.order.avgPrice).toBe('50000');
    expect(r.fills.map((f: { isMaker: boolean }) => f.isMaker)).toEqual([false, false]);

    // Taker paid 0.7 * 50000 = 35000 USDT; price improvement (100 * 0.7) released. Fee 0.1% of BTC received.
    const tUsdt = await balance(h, t.id, 'USDT');
    expect(tUsdt.available.toFixed()).toBe('65000');
    expect(tUsdt.locked.toFixed()).toBe('0');
    expect((await balance(h, t.id, 'BTC')).available.toFixed()).toBe('0.6993');
    // m1 fully filled first (time priority), m2 partially.
    expect((await balance(h, m1.id, 'USDT')).available.toFixed()).toBe('24975'); // 25000 - 0.1% maker fee
    expect((await balance(h, m2.id, 'USDT')).available.toFixed()).toBe('9990'); // 10000 - 0.1%
    expect((await balance(h, m2.id, 'BTC')).locked.toFixed()).toBe('0.3');
    await assertSpotLocksMatchOrders(h, m2.id, 'BTC');
    // Fees are accrued by settlement and swept into the fee collector in aggregate.
    expect(await sweepFeeAccruals(h.core)).toBeGreaterThan(0);
    const fees = await balance(h, h.core.users.systemIds.feeCollector, 'USDT');
    expect(fees.available.toFixed()).toBe('35'); // 25 + 10
  });

  it('rests GTC remainders, cancels and releases funds exactly', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '10000']]);
    const o = (
      await order(u.token, { symbol: 'ETHUSDT', side: 'BUY', type: 'LIMIT', price: '2000', quantity: '2' })
    ).json().order;
    expect(o.status).toBe('OPEN');
    expect((await balance(h, u.id, 'USDT')).locked.toFixed()).toBe('4000');
    const c = await api(h, 'DELETE', `/api/v1/spot/orders/${o.id}`, { token: u.token });
    expect(c.json().status).toBe('CANCELLED');
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('10000');
    const again = await api(h, 'DELETE', `/api/v1/spot/orders/${o.id}`, { token: u.token });
    expect(again.json().error.code).toBe('ORDER_NOT_CANCELLABLE');
  });

  it('rejects insufficient balance and filter violations without side effects', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '100']]);
    const insufficient = await order(u.token, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      price: '40000',
      quantity: '0.01',
    });
    expect(insufficient.statusCode).toBe(422);
    expect(insufficient.json().error.code).toBe('INSUFFICIENT_BALANCE');
    const tick = await order(u.token, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      price: '40000.001',
      quantity: '0.001',
    });
    expect(tick.json().error.code).toBe('FILTER_VIOLATION');
    const notional = await order(u.token, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      price: '1000',
      quantity: '0.001',
    });
    expect(notional.json().error.code).toBe('FILTER_VIOLATION');
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('100');
    const orders = await h.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?', [u.id]);
    expect(Number(orders!.c)).toBe(0);
  });

  it('executes market buys by quote amount and IOC/FOK/post-only semantics', async () => {
    const mm = await createUser(h, [['SPOT', 'ETH', '100']]);
    await order(mm.token, { symbol: 'ETHUSDT', side: 'SELL', type: 'LIMIT', price: '3000', quantity: '1' });
    await order(mm.token, { symbol: 'ETHUSDT', side: 'SELL', type: 'LIMIT', price: '3010', quantity: '1' });
    await flushBooks(h);
    const u = await createUser(h, [['SPOT', 'USDT', '10000']]);
    const mkt = (
      await order(u.token, { symbol: 'ETHUSDT', side: 'BUY', type: 'MARKET', quoteQuantity: '4505' })
    ).json();
    expect(mkt.order.status).toBe('FILLED');
    expect(mkt.order.filledQuantity).toBe('1.5'); // 1 @ 3000 + 0.5 @ 3010
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('5495');
    // Only 0.5 ETH remains at 3010: a 1.5 FOK cannot fully fill and must not touch the book.
    const fok = (
      await order(u.token, {
        symbol: 'ETHUSDT',
        side: 'BUY',
        type: 'LIMIT',
        price: '3010',
        quantity: '1.5',
        timeInForce: 'FOK',
      })
    ).json();
    expect(fok.order.status).toBe('EXPIRED');
    expect(fok.order.filledQuantity).toBe('0');
    const ioc = (
      await order(u.token, {
        symbol: 'ETHUSDT',
        side: 'BUY',
        type: 'LIMIT',
        price: '3010',
        quantity: '1',
        timeInForce: 'IOC',
      })
    ).json();
    expect(ioc.order.status).toBe('EXPIRED');
    expect(ioc.order.filledQuantity).toBe('0.5');
    const post = (
      await order(u.token, {
        symbol: 'ETHUSDT',
        side: 'BUY',
        type: 'LIMIT',
        price: '3010',
        quantity: '0.1',
        postOnly: true,
      })
    ).json();
    expect(post.order.status).toBe('OPEN'); // book is empty on the ask side now, so it rests
    await assertSpotLocksMatchOrders(h, u.id, 'USDT');
  });

  it('amends: reducing size keeps priority, changing price re-queues and re-matches', async () => {
    const a = await createUser(h, [['SPOT', 'USDT', '100000']]);
    const b = await createUser(h, [['SPOT', 'USDT', '100000']]);
    const s = await createUser(h, [['SPOT', 'BTC', '1']]);
    const oa = (
      await order(a.token, { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '45000', quantity: '0.2' })
    ).json().order;
    const ob = (
      await order(b.token, { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '45000', quantity: '0.2' })
    ).json().order;
    const amended = await api(h, 'PATCH', `/api/v1/spot/orders/${oa.id}`, {
      token: a.token,
      body: { quantity: '0.1' },
    });
    expect(amended.json().quantity).toBe('0.1');
    expect((await balance(h, a.id, 'USDT')).locked.toFixed()).toBe('4500');
    const sell = (
      await order(s.token, { symbol: 'BTCUSDT', side: 'SELL', type: 'LIMIT', price: '45000', quantity: '0.1' })
    ).json();
    expect(sell.fills[0].orderId).toBe(sell.order.id);
    const filledA = (await api(h, 'GET', `/api/v1/orders/${oa.id}`, { token: a.token })).json();
    expect(filledA.order.status).toBe('FILLED'); // a kept time priority
    // b raises its price above the best ask -> crosses and fills immediately.
    await order(s.token, { symbol: 'BTCUSDT', side: 'SELL', type: 'LIMIT', price: '46000', quantity: '0.2' });
    const reprice = await api(h, 'PATCH', `/api/v1/spot/orders/${ob.id}`, { token: b.token, body: { price: '46000' } });
    expect(reprice.json().status).toBe('FILLED');
    await assertSpotLocksMatchOrders(h, b.id, 'USDT');
  });

  it('OCO: the stop leg is cancelled when the limit leg executes', async () => {
    await setPrice(h, 'LINK', '14');
    const u = await createUser(h, [['SPOT', 'LINK', '100']]);
    const buyer = await createUser(h, [['SPOT', 'USDT', '100000']]);
    await h.core.redis.main.set(`gctest:ticker:LINKUSDT`, JSON.stringify({ symbol: 'LINKUSDT', lastPrice: '14' }));
    const oco = await api(h, 'POST', '/api/v1/spot/orders/oco', {
      token: u.token,
      body: { symbol: 'LINKUSDT', side: 'SELL', quantity: '10', price: '20', stopPrice: '10', stopLimitPrice: '9.9' },
    });
    expect(oco.statusCode).toBe(201);
    // One reservation covers both legs.
    expect((await balance(h, u.id, 'LINK')).locked.toFixed()).toBe('10');
    const [limitLeg, stopLeg] = oco.json().orders.map((o: { order: { id: string } }) => o.order.id);
    await order(buyer.token, { symbol: 'LINKUSDT', side: 'BUY', type: 'LIMIT', price: '20', quantity: '10' });
    await h.runner.idle();
    const limit = (await api(h, 'GET', `/api/v1/orders/${limitLeg}`, { token: u.token })).json().order;
    const stop = (await api(h, 'GET', `/api/v1/orders/${stopLeg}`, { token: u.token })).json().order;
    expect(limit.status).toBe('FILLED');
    expect(stop.status).toBe('CANCELLED');
    expect((await balance(h, u.id, 'LINK')).locked.toFixed()).toBe('0');
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('199.8');
  });

  it('fires stop orders through the trigger monitor and executes them', async () => {
    const mm = await createUser(h, [['SPOT', 'USDT', '1000000']]);
    await order(mm.token, { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '44000', quantity: '1' });
    await flushBooks(h);
    const u = await createUser(h, [['SPOT', 'BTC', '0.5']]);
    await h.core.redis.main.set(`gctest:ticker:BTCUSDT`, JSON.stringify({ symbol: 'BTCUSDT', lastPrice: '45500' }));
    const stop = (
      await order(u.token, {
        symbol: 'BTCUSDT',
        side: 'SELL',
        type: 'STOP_MARKET',
        stopPrice: '45000',
        quantity: '0.5',
      })
    ).json().order;
    expect(stop.status).toBe('NEW');
    expect(stop.triggerState).toBe('PENDING');
    expect((await balance(h, u.id, 'BTC')).locked.toFixed()).toBe('0.5');
    const monitor = new TriggerMonitor(h.core, h.engine);
    await monitor.reload();
    await monitor.onPrice(h.core.markets.require('BTCUSDT').id, D('45200'), 'LAST_PRICE');
    expect((await api(h, 'GET', `/api/v1/orders/${stop.id}`, { token: u.token })).json().order.status).toBe('NEW');
    await monitor.onPrice(h.core.markets.require('BTCUSDT').id, D('44990'), 'LAST_PRICE');
    await h.runner.idle();
    const done = (await api(h, 'GET', `/api/v1/orders/${stop.id}`, { token: u.token })).json();
    expect(done.order.status).toBe('FILLED');
    expect(done.order.triggerState).toBe('TRIGGERED');
    expect(done.history.map((x: { event: string }) => x.event)).toContain('TRIGGERED');
    expect((await balance(h, u.id, 'USDT')).available.toFixed()).toBe('21978'); // 0.5 * 44000 - 0.1%
  });
});

describe('portfolio', () => {
  it('values balances and reports inflows, open orders and positions', async () => {
    const u = await createUser(h, [
      ['SPOT', 'USDT', '10000'],
      ['SPOT', 'BTC', '0.1'],
      ['FUTURES', 'USDT', '2000'],
    ]);
    // Resting bid far below the market: funds move to `locked` but stay part of the portfolio value.
    expect(
      (await order(u.token, { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '30000', quantity: '0.01' })).json()
        .order.status,
    ).toBe('OPEN');
    const s = (await api(h, 'GET', '/api/v1/portfolio/summary', { token: u.token })).json();
    // 10,000 USDT + 0.1 BTC @ 50,000 + 2,000 USDT futures margin balance.
    expect(s.totalValue).toBe('17000');
    expect(s.spotValue).toBe('15000');
    expect(s.futuresValue).toBe('2000');
    expect(s.totalDeposits).toBe('17000'); // sandbox credits count as inflow
    expect(s.totalWithdrawals).toBe('0');
    expect(s.realizedPnl).toBe('0');
    expect(s.roi).toBe('0');
    expect(s.openOrders).toBe(1);
    expect(s.openPositions).toBe(0);
  });
});
