import { describe, expect, it } from 'vitest';
import { D, type Decimal } from '@gocrypto/trading-utils';
import { OrderBook, type Side, type TakerOrder } from './order-book';

const cfg = { symbol: 'BTCUSDT', tickSize: '0.01', stepSize: '0.0001' };

let n = 0;
function limit(book: OrderBook, userId: string, side: Side, price: string, qty: string, extra: Partial<TakerOrder> = {}) {
  n += 1;
  return book.match({
    id: `o${n}`,
    userId,
    side,
    kind: 'LIMIT',
    price: D(price),
    quantity: D(qty),
    timeInForce: 'GTC',
    ...extra,
  });
}

function market(book: OrderBook, userId: string, side: Side, qty: string | null, extra: Partial<TakerOrder> = {}) {
  n += 1;
  return book.match({
    id: `m${n}`,
    userId,
    side,
    kind: 'MARKET',
    quantity: qty ? D(qty) : undefined,
    timeInForce: 'IOC',
    ...extra,
  });
}

const s = (d: Decimal) => d.toFixed();

describe('OrderBook matching', () => {
  it('rests non-crossing limit orders and reports best prices', () => {
    const b = new OrderBook(cfg);
    expect(limit(b, 'a', 'BUY', '100', '1').outcome).toBe('RESTING');
    expect(limit(b, 'b', 'SELL', '101', '2').outcome).toBe('RESTING');
    expect(s(b.bestBid()!.price)).toBe('100');
    expect(s(b.bestAsk()!.price)).toBe('101');
    expect(b.depth()).toEqual({ bids: [['100', '1']], asks: [['101', '2']] });
    b.checkInvariants();
  });

  it('enforces price-time priority', () => {
    const b = new OrderBook(cfg);
    const first = limit(b, 'm1', 'SELL', '101', '1');
    const second = limit(b, 'm2', 'SELL', '101', '1');
    limit(b, 'm3', 'SELL', '100.5', '1');
    void first;
    void second;
    const r = market(b, 't', 'BUY', '2.5');
    expect(r.fills.map((f) => [f.makerUserId, s(f.price), s(f.quantity)])).toEqual([
      ['m3', '100.5', '1'],
      ['m1', '101', '1'],
      ['m2', '101', '0.5'],
    ]);
    expect(r.outcome).toBe('FILLED');
    expect(s(b.bestAsk()!.total)).toBe('0.5');
    b.checkInvariants();
  });

  it('executes at the maker price (price improvement for the taker)', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '99', '1');
    const r = limit(b, 't', 'BUY', '105', '1');
    expect(s(r.fills[0]!.price)).toBe('99');
    expect(s(r.filledQuote)).toBe('99');
  });

  it('partially fills and rests the remainder of a GTC order', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '100', '0.4');
    const r = limit(b, 't', 'BUY', '100', '1');
    expect(r.outcome).toBe('RESTING');
    expect(s(r.filledQty)).toBe('0.4');
    expect(s(r.rested!.remaining)).toBe('0.6');
    expect(s(b.bestBid()!.price)).toBe('100');
    expect(b.bestAsk()).toBeUndefined();
    b.checkInvariants();
  });

  it('expires the remainder of IOC orders', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '100', '0.4');
    const r = limit(b, 't', 'BUY', '100', '1', { timeInForce: 'IOC' });
    expect(r.outcome).toBe('EXPIRED');
    expect(s(r.filledQty)).toBe('0.4');
    expect(b.bestBid()).toBeUndefined();
  });

  it('rejects FOK orders that cannot fully fill without touching the book', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '100', '0.4');
    const r = limit(b, 't', 'BUY', '100', '1', { timeInForce: 'FOK' });
    expect(r.outcome).toBe('REJECTED');
    expect(r.rejectReason).toBe('FOK_NOT_FILLABLE');
    expect(s(b.bestAsk()!.total)).toBe('0.4');
    const ok = limit(b, 't', 'BUY', '100', '0.4', { timeInForce: 'FOK' });
    expect(ok.outcome).toBe('FILLED');
  });

  it('rejects post-only orders that would take liquidity', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '100', '1');
    expect(limit(b, 't', 'BUY', '100', '1', { timeInForce: 'GTX' }).rejectReason).toBe('POST_ONLY_WOULD_TAKE');
    expect(limit(b, 't', 'BUY', '99.99', '1', { timeInForce: 'GTX' }).outcome).toBe('RESTING');
  });

  it('fills market buys by quote budget with step rounding', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '100', '1');
    limit(b, 'm', 'SELL', '200', '1');
    const r = market(b, 't', 'BUY', null, { quoteBudget: D('150') });
    // 1 @ 100 = 100, then floor(50/200, 0.0001) = 0.25 @ 200 = 50
    expect(r.fills.map((f) => s(f.quantity))).toEqual(['1', '0.25']);
    expect(s(r.filledQuote)).toBe('150');
    expect(r.outcome).toBe('FILLED');
  });

  it('caps quote consumption by the locked amount', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '100', '10');
    const r = market(b, 't', 'BUY', '5', { maxQuote: D('250') });
    expect(s(r.filledQty)).toBe('2.5');
    expect(r.outcome).toBe('EXPIRED');
    expect(r.stopReason).toBe('BUDGET');
  });

  it('stops market orders at the price protection band', () => {
    const b = new OrderBook(cfg);
    limit(b, 'm', 'SELL', '100', '1');
    limit(b, 'm', 'SELL', '110', '1');
    const r = market(b, 't', 'BUY', '2', { priceLimit: D('105') });
    expect(s(r.filledQty)).toBe('1');
    expect(r.stopReason).toBe('PRICE_LIMIT');
    expect(r.outcome).toBe('EXPIRED');
  });

  it('reports NO_LIQUIDITY for market orders on an empty book', () => {
    const b = new OrderBook(cfg);
    const r = market(b, 't', 'SELL', '1');
    expect(r.outcome).toBe('EXPIRED');
    expect(r.rejectReason).toBe('NO_LIQUIDITY');
  });

  it('applies self-trade prevention (expire maker by default)', () => {
    const b = new OrderBook(cfg);
    limit(b, 'u1', 'SELL', '100', '1');
    limit(b, 'u2', 'SELL', '100', '1');
    const r = market(b, 'u1', 'BUY', '1');
    expect(r.expiredMakers).toHaveLength(1);
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]!.makerUserId).toBe('u2');
    b.checkInvariants();
  });

  it('applies self-trade prevention (expire taker)', () => {
    const b = new OrderBook(cfg);
    limit(b, 'u1', 'SELL', '100', '1');
    const r = limit(b, 'u1', 'BUY', '100', '1', { stp: 'EXPIRE_TAKER' });
    expect(r.fills).toHaveLength(0);
    expect(r.outcome).toBe('EXPIRED');
    expect(r.stopReason).toBe('SELF_TRADE');
    expect(b.size).toBe(1);
  });

  it('cancels and reduces orders while keeping priority', () => {
    const b = new OrderBook(cfg);
    const a = limit(b, 'a', 'BUY', '100', '1');
    limit(b, 'b', 'BUY', '100', '1');
    void a;
    expect(b.reduce(`o${n - 1}`, D('0.5'))).toBe(true);
    expect(s(b.bestBid()!.total)).toBe('1.5');
    const r = market(b, 't', 'SELL', '0.5');
    expect(r.fills[0]!.makerUserId).toBe('a');
    expect(b.cancel(`o${n - 1}`)?.userId).toBe('b');
    expect(b.size).toBe(0);
    b.checkInvariants();
  });

  it('aggregates depth by price step', () => {
    const b = new OrderBook(cfg);
    limit(b, 'a', 'BUY', '100.11', '1');
    limit(b, 'a', 'BUY', '100.19', '2');
    limit(b, 'a', 'BUY', '99.5', '1');
    expect(b.depth(10, '1').bids).toEqual([
      ['100', '3'],
      ['99', '1'],
    ]);
  });

  it('keeps invariants and conserves quantity under random load', () => {
    const b = new OrderBook(cfg);
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let restedTotal = D(0);
    let filledTotal = D(0);
    for (let i = 0; i < 3000; i++) {
      const side: Side = rnd() < 0.5 ? 'BUY' : 'SELL';
      const price = (95 + Math.floor(rnd() * 1000) / 100).toFixed(2);
      const qty = (0.0001 + Math.floor(rnd() * 20000) / 10000).toFixed(4);
      const user = `u${Math.floor(rnd() * 8)}`;
      const r = rnd() < 0.85 ? limit(b, user, side, price, qty) : market(b, user, side, qty);
      filledTotal = filledTotal.plus(r.filledQty);
      if (r.rested) restedTotal = restedTotal.plus(r.rested.remaining);
      if (rnd() < 0.1) {
        const victims = b.allOrders();
        const v = victims[Math.floor(rnd() * victims.length)];
        if (v) {
          const c = b.cancel(v.id)!;
          restedTotal = restedTotal.minus(c.remaining);
        }
      }
      if (i % 250 === 0) b.checkInvariants();
    }
    b.checkInvariants();
    // Everything that rested is either still resting, was filled as a maker, or expired by STP.
    const resting = b.allOrders().reduce((acc, o) => acc.plus(o.remaining), D(0));
    expect(resting.gt(0)).toBe(true);
    expect(filledTotal.gt(0)).toBe(true);
    expect(resting.lte(restedTotal)).toBe(true);
  });
});
