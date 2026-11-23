import { LiquidationEngine } from '@gocrypto/risk-engine';
import { OptionsLifecycleService, PriceService } from '@gocrypto/server-core';
import { D, formatOptionSymbol } from '@gocrypto/trading-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, type TestUser, api, assertLedgerReconciles, balance, createUser, flushBooks, setPrice, startHarness } from './harness';

let h: Harness;
let mm: TestUser;
const PERP = 'BTCUSDT-PERP';

beforeAll(async () => {
  h = await startHarness();
  await setPrice(h, 'BTC', '50000');
  mm = await createUser(h, [
    ['FUTURES', 'USDT', '10000000'],
    ['OPTIONS', 'USDT', '10000000'],
  ]);
});
afterAll(async () => {
  await assertLedgerReconciles(h);
  await h.close();
});

const fut = (token: string, body: Record<string, unknown>) => api(h, 'POST', '/api/v1/futures/orders', { token, body });
const quote = async (side: 'BUY' | 'SELL', price: string, qty: string) => {
  const r = await fut(mm.token, { symbol: PERP, side, type: 'LIMIT', price, quantity: qty });
  expect(r.statusCode).toBe(201);
  await flushBooks(h);
  return r.json().order;
};
async function position(u: TestUser) {
  return (await api(h, 'GET', '/api/v1/futures/positions', { token: u.token })).json().find((p: { symbol: string }) => p.symbol === PERP) ?? null;
}

describe('perpetual futures', () => {
  it('opens a leveraged long, locks initial margin, charges fees and realises PnL on close', async () => {
    const u = await createUser(h, [['FUTURES', 'USDT', '10000']]);
    expect((await api(h, 'POST', '/api/v1/futures/leverage', { token: u.token, body: { symbol: PERP, leverage: 10 } })).statusCode).toBe(200);
    await quote('SELL', '50000', '0.2');
    const open = (await fut(u.token, { symbol: PERP, side: 'BUY', type: 'MARKET', quantity: '0.2' })).json();
    expect(open.order.status).toBe('FILLED');
    const p = await position(u);
    expect(p.side).toBe('LONG');
    expect(p.entryPrice).toBe('50000');
    expect(p.margin).toBe('1000'); // 10_000 notional / 10x
    let w = await balance(h, u.id, 'USDT', 'FUTURES');
    expect(w.locked.toFixed()).toBe('1000');
    expect(w.available.toFixed()).toBe('8995'); // 10_000 - 1_000 margin - 5 taker fee (0.05%)

    // Price rises; close at 51_000 against a resting bid.
    await quote('BUY', '51000', '0.2');
    await setPrice(h, 'BTC', '51000');
    const close = await api(h, 'POST', `/api/v1/futures/positions/${PERP}/close`, { token: u.token, body: {} });
    expect(close.json().order.status).toBe('FILLED');
    expect(await position(u)).toBeNull();
    w = await balance(h, u.id, 'USDT', 'FUTURES');
    // +200 PnL, fees 5 + 5.1
    expect(w.available.toFixed()).toBe('10189.9');
    expect(w.locked.toFixed()).toBe('0');
    const fills = (await api(h, 'GET', '/api/v1/trades?marketType=FUTURES', { token: u.token })).json().items;
    expect(fills.some((f: { realizedPnl: string | null }) => f.realizedPnl === '200')).toBe(true);
    await setPrice(h, 'BTC', '50000');
  });

  it('enforces leverage tiers, reduce-only and margin sufficiency', async () => {
    const u = await createUser(h, [['FUTURES', 'USDT', '1000']]);
    await api(h, 'POST', '/api/v1/futures/leverage', { token: u.token, body: { symbol: PERP, leverage: 125 } });
    const tooBig = await fut(u.token, { symbol: PERP, side: 'BUY', type: 'LIMIT', price: '50000', quantity: '2' });
    expect(tooBig.json().error.code).toBe('LEVERAGE_TOO_HIGH'); // 100k notional allows max 100x
    const reduce = await fut(u.token, { symbol: PERP, side: 'SELL', type: 'LIMIT', price: '50000', quantity: '0.01', reduceOnly: true });
    expect(reduce.json().error.code).toBe('REDUCE_ONLY_REJECTED');
    await api(h, 'POST', '/api/v1/futures/leverage', { token: u.token, body: { symbol: PERP, leverage: 2 } });
    const margin = await fut(u.token, { symbol: PERP, side: 'BUY', type: 'LIMIT', price: '50000', quantity: '0.1' });
    expect(margin.json().error.code).toBe('INSUFFICIENT_MARGIN'); // needs 2_500
  });

  it('caps withdrawable futures balance by unrealised losses', async () => {
    const u = await createUser(h, [['FUTURES', 'USDT', '2000']]);
    await api(h, 'POST', '/api/v1/futures/leverage', { token: u.token, body: { symbol: PERP, leverage: 10 } });
    await quote('SELL', '50000', '0.2');
    await fut(u.token, { symbol: PERP, side: 'BUY', type: 'MARKET', quantity: '0.2' });
    await setPrice(h, 'BTC', '49000'); // uPnL -200
    const tooMuch = await api(h, 'POST', '/api/v1/wallet/transfer', { token: u.token, body: { asset: 'USDT', amount: '900', from: 'FUTURES', to: 'SPOT' } });
    expect(tooMuch.json().error.code).toBe('INSUFFICIENT_BALANCE');
    const ok = await api(h, 'POST', '/api/v1/wallet/transfer', { token: u.token, body: { asset: 'USDT', amount: '700', from: 'FUTURES', to: 'SPOT' } });
    expect(ok.statusCode).toBe(201);
    expect((await balance(h, u.id, 'USDT', 'SPOT')).available.toFixed()).toBe('700');
    await setPrice(h, 'BTC', '50000');
  });

  it('liquidates an isolated position exactly once, even under concurrent attempts', async () => {
    const u = await createUser(h, [['FUTURES', 'USDT', '1100']]);
    await api(h, 'POST', '/api/v1/futures/margin-mode', { token: u.token, body: { symbol: PERP, marginMode: 'ISOLATED' } });
    await api(h, 'POST', '/api/v1/futures/leverage', { token: u.token, body: { symbol: PERP, leverage: 10 } });
    await quote('SELL', '50000', '0.2');
    await fut(u.token, { symbol: PERP, side: 'BUY', type: 'MARKET', quantity: '0.2' });
    const p = await position(u);
    expect(p.marginMode).toBe('ISOLATED');
    const liqPrice = D(p.liquidationPrice);
    expect(liqPrice.gt('45000') && liqPrice.lt('45500')).toBe(true);

    const engine = new LiquidationEngine(h.core, h.engine);
    await setPrice(h, 'BTC', '46000');
    expect(await engine.liquidate(u.id)).toEqual([]); // still safe
    await setPrice(h, 'BTC', '45000');
    // Concurrent liquidations: the DB row locks + (position_id, version) uniqueness allow one.
    const results = await Promise.allSettled([engine.liquidate(u.id), engine.liquidate(u.id), engine.execute(u.id)]);
    const records = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    expect(records).toHaveLength(1);
    const rows = await h.core.db.query<{ c: number }>('SELECT COUNT(*) AS c FROM liquidations WHERE user_id = ?', [u.id]);
    expect(Number(rows[0]!.c)).toBe(1);
    expect(await position(u)).toBeNull();
    const w = await balance(h, u.id, 'USDT', 'FUTURES');
    // Lost the whole isolated margin (1000) plus the opening fee; the rest of the wallet is untouched.
    expect(w.available.toFixed()).toBe('95');
    expect(w.locked.toFixed()).toBe('0');
    const ins = await h.core.futures.positionsOf(h.core.users.systemIds.insuranceFund);
    expect(ins.find((x) => x.marketId === h.core.markets.require(PERP).id)?.side).toBe('LONG');
    const notifications = await h.core.db.one<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'LIQUIDATION'", [u.id]);
    expect(Number(notifications!.c)).toBe(1);
    await setPrice(h, 'BTC', '50000');
  });

  it('liquidates cross positions against the whole cross balance', async () => {
    const u = await createUser(h, [['FUTURES', 'USDT', '600']]);
    await api(h, 'POST', '/api/v1/futures/leverage', { token: u.token, body: { symbol: PERP, leverage: 20 } });
    await quote('BUY', '50000', '0.2');
    await fut(u.token, { symbol: PERP, side: 'SELL', type: 'MARKET', quantity: '0.2' }); // short 10k notional, 500 margin
    const engine = new LiquidationEngine(h.core, h.engine);
    await setPrice(h, 'BTC', '52000'); // loss 400, equity ~195 > mm 52
    expect(await engine.liquidate(u.id)).toEqual([]);
    await setPrice(h, 'BTC', '52900'); // loss 580 -> equity ~15 < mm
    const recs = await engine.execute(u.id);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.marginMode).toBe('CROSS');
    const w = await balance(h, u.id, 'USDT', 'FUTURES');
    expect(w.available.gte(0)).toBe(true);
    expect(w.available.lt('20')).toBe(true);
    await setPrice(h, 'BTC', '50000');
  });

  it('settles funding exactly once per funding time (longs pay shorts)', async () => {
    const long = await createUser(h, [['FUTURES', 'USDT', '10000']]);
    const short = await createUser(h, [['FUTURES', 'USDT', '10000']]);
    await fut(short.token, { symbol: PERP, side: 'SELL', type: 'LIMIT', price: '50000', quantity: '0.1' });
    await fut(long.token, { symbol: PERP, side: 'BUY', type: 'LIMIT', price: '50000', quantity: '0.1' });
    const before = { l: await balance(h, long.id, 'USDT', 'FUTURES'), s: await balance(h, short.id, 'USDT', 'FUTURES') };
    const market = h.core.markets.require(PERP);
    const t = Date.UTC(2030, 0, 1, 8);
    await h.core.funding.settle(market, t, D('0.001'), D('50000'), D('50000'));
    await h.core.funding.settle(market, t, D('0.001'), D('50000'), D('50000'));
    const after = { l: await balance(h, long.id, 'USDT', 'FUTURES'), s: await balance(h, short.id, 'USDT', 'FUTURES') };
    expect(before.l.available.minus(after.l.available).toFixed()).toBe('5'); // 0.1 * 50_000 * 0.1%
    expect(after.s.available.minus(before.s.available).toFixed()).toBe('5');
    const pays = await h.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM funding_payments WHERE user_id = ?', [long.id]);
    expect(Number(pays!.c)).toBe(1);
  });
});

describe('options', () => {
  it('buys calls, margins short puts and cash-settles at expiry exactly once', async () => {
    await setPrice(h, 'BTC', '50000');
    const expiry = Date.UTC(new Date().getUTCFullYear() + 1, 0, 15, 8);
    const btc = h.core.assets.require('BTC');
    const usdt = h.core.assets.require('USDT');
    const ids: Record<string, number> = {};
    for (const [type, strike] of [
      ['CALL', '50000'],
      ['PUT', '48000'],
    ] as const) {
      const symbol = formatOptionSymbol('BTC', expiry, strike, type);
      const res = await h.core.db.execute(
        `INSERT INTO markets (symbol, type, display_name, base_asset_id, quote_asset_id, tick_size, step_size, min_qty, max_qty, min_notional, price_band)
         VALUES (?, 'OPTIONS', ?, ?, ?, '5', '0.01', '0.01', '1000', 0, 0.2)`,
        [symbol, symbol, btc.id, usdt.id],
      );
      await h.core.db.execute('INSERT INTO options_contracts (market_id, underlying_asset_id, quote_asset_id, option_type, strike, expiry_at) VALUES (?, ?, ?, ?, ?, ?)', [
        res.insertId,
        btc.id,
        usdt.id,
        type,
        strike,
        new Date(expiry),
      ]);
      ids[type] = Number(res.insertId);
    }
    await h.core.markets.load();
    const call = formatOptionSymbol('BTC', expiry, '50000', 'CALL');
    const put = formatOptionSymbol('BTC', expiry, '48000', 'PUT');
    const buyer = await createUser(h, [['OPTIONS', 'USDT', '50000']]);
    const writer = await createUser(h, [['OPTIONS', 'USDT', '50000']]);

    // MM offers the call; buyer lifts it.
    await api(h, 'POST', '/api/v1/options/orders', { token: mm.token, body: { symbol: call, side: 'SELL', type: 'LIMIT', price: '2000', quantity: '1' } });
    await flushBooks(h);
    const bought = (await api(h, 'POST', '/api/v1/options/orders', { token: buyer.token, body: { symbol: call, side: 'BUY', type: 'LIMIT', price: '2000', quantity: '1' } })).json();
    expect(bought.order.status).toBe('FILLED');
    const wb = await balance(h, buyer.id, 'USDT', 'OPTIONS');
    expect(wb.available.toFixed()).toBe('47985'); // 2000 premium + min(0.03% * 50k, 12.5% * 2000) = 15 fee

    // Writer sells a put: premium credited, short margin locked.
    await api(h, 'POST', '/api/v1/options/orders', { token: mm.token, body: { symbol: put, side: 'BUY', type: 'LIMIT', price: '1000', quantity: '1' } });
    const sold = (await api(h, 'POST', '/api/v1/options/orders', { token: writer.token, body: { symbol: put, side: 'SELL', type: 'LIMIT', price: '1000', quantity: '1' } })).json();
    expect(sold.order.status).toBe('FILLED');
    const ww = await balance(h, writer.id, 'USDT', 'OPTIONS');
    expect(ww.locked.gt(4000)).toBe(true); // margin ~ max(0.15*50k - 2k, 0.1*48k) + mark
    const positions = (await api(h, 'GET', '/api/v1/options/positions', { token: writer.token })).json();
    expect(positions[0].side).toBe('SHORT');

    // Expiry: settle at 45_000 -> call worthless, put pays 3_000.
    const lifecycle = new OptionsLifecycleService(h.core, h.engine);
    await lifecycle.settleContract(ids.CALL!, D('45000'));
    await lifecycle.settleContract(ids.PUT!, D('45000'));
    await lifecycle.settleContract(ids.PUT!, D('45000')); // idempotent
    const after = await balance(h, writer.id, 'USDT', 'OPTIONS');
    expect(after.locked.toFixed()).toBe('0');
    expect(after.available.toFixed()).toBe(D('50000').plus('1000').minus(sold.order.feeTotal).minus('3000').toFixed());
    const settlements = await h.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM options_settlements WHERE market_id = ?', [ids.PUT]);
    expect(Number(settlements!.c)).toBe(2); // writer + MM
    expect((await api(h, 'GET', '/api/v1/options/positions', { token: buyer.token })).json()).toEqual([]);
    await h.core.redis.main.del(PriceService.indexKey('BTC'));
  });
});
