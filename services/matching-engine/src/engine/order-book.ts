import { D, type Decimal, ZERO, dmin, floorToStep } from '@gocrypto/trading-utils';

export type Side = 'BUY' | 'SELL';
export type SelfTradePrevention = 'EXPIRE_MAKER' | 'EXPIRE_TAKER' | 'NONE';

/** An order resting in the book (doubly-linked within its price level for O(1) removal). */
export interface RestingOrder {
  id: string;
  userId: string;
  side: Side;
  price: Decimal;
  remaining: Decimal;
  /** Time priority: lower = earlier. Assigned by the engine when the order enters the book. */
  seq: number;
  reduceOnly: boolean;
  prev: RestingOrder | null;
  next: RestingOrder | null;
  level: PriceLevel | null;
}

export interface PriceLevel {
  price: Decimal;
  key: string;
  head: RestingOrder | null;
  tail: RestingOrder | null;
  total: Decimal;
  count: number;
}

export interface TakerOrder {
  id: string;
  userId: string;
  side: Side;
  kind: 'LIMIT' | 'MARKET';
  /** Limit price (required for LIMIT). */
  price?: Decimal;
  /** Base quantity. Required unless quoteBudget is set. */
  quantity?: Decimal;
  /** Market buy by quote amount: spend at most this much quote. */
  quoteBudget?: Decimal;
  /** Cap on quote consumed by a buy (the funds locked for it). */
  maxQuote?: Decimal;
  timeInForce: 'GTC' | 'IOC' | 'FOK' | 'GTX';
  /** Worst acceptable execution price (market-order protection band). */
  priceLimit?: Decimal;
  stp?: SelfTradePrevention;
  reduceOnly?: boolean;
}

export interface Fill {
  seq: number;
  price: Decimal;
  quantity: Decimal;
  quote: Decimal;
  takerSide: Side;
  takerOrderId: string;
  takerUserId: string;
  makerOrderId: string;
  makerUserId: string;
  makerRemaining: Decimal;
  makerDone: boolean;
}

export type MatchOutcome = 'FILLED' | 'RESTING' | 'EXPIRED' | 'REJECTED';
export type RejectReason = 'POST_ONLY_WOULD_TAKE' | 'FOK_NOT_FILLABLE' | 'NO_LIQUIDITY' | 'INVALID';
export type StopReason = 'FILLED' | 'NO_LIQUIDITY' | 'PRICE_LIMIT' | 'BUDGET' | 'SELF_TRADE' | null;

export interface MatchResult {
  fills: Fill[];
  /** Makers removed by self-trade prevention. */
  expiredMakers: { orderId: string; userId: string; remaining: Decimal }[];
  filledQty: Decimal;
  filledQuote: Decimal;
  /** Unfilled base quantity (0 for quote-budget orders, which have no base target). */
  remainingQty: Decimal;
  outcome: MatchOutcome;
  rejectReason?: RejectReason;
  stopReason: StopReason;
  /** Set when the remainder now rests in the book. */
  rested?: { price: Decimal; remaining: Decimal; seq: number };
}

export interface BookConfig {
  symbol: string;
  tickSize: string;
  stepSize: string;
}

export interface DepthSnapshot {
  bids: [string, string][];
  asks: [string, string][];
}

/**
 * Limit order book for one market with strict price-time priority.
 * Pure and synchronous: no IO, deterministic given the same sequence of commands.
 */
export class OrderBook {
  private readonly bids: PriceLevel[] = []; // sorted by price descending
  private readonly asks: PriceLevel[] = []; // sorted by price ascending
  private readonly bidLevels = new Map<string, PriceLevel>();
  private readonly askLevels = new Map<string, PriceLevel>();
  private readonly orders = new Map<string, RestingOrder>();
  private readonly step: Decimal;
  orderSeq: number;
  tradeSeq: number;

  constructor(
    readonly config: BookConfig,
    seqs: { orderSeq?: number; tradeSeq?: number } = {},
  ) {
    this.step = D(config.stepSize);
    this.orderSeq = seqs.orderSeq ?? 0;
    this.tradeSeq = seqs.tradeSeq ?? 0;
  }

  get size(): number {
    return this.orders.size;
  }

  has(orderId: string): boolean {
    return this.orders.has(orderId);
  }

  get(orderId: string): RestingOrder | undefined {
    return this.orders.get(orderId);
  }

  bestBid(): PriceLevel | undefined {
    return this.bids[0];
  }

  bestAsk(): PriceLevel | undefined {
    return this.asks[0];
  }

  /** Orders of one user currently resting (used for STP diagnostics and reduce-only checks). */
  ordersOf(userId: string): RestingOrder[] {
    return [...this.orders.values()].filter((o) => o.userId === userId);
  }

  allOrders(): RestingOrder[] {
    return [...this.orders.values()];
  }

  // ───────── level management ─────────

  private levels(side: Side): PriceLevel[] {
    return side === 'BUY' ? this.bids : this.asks;
  }

  private levelMap(side: Side): Map<string, PriceLevel> {
    return side === 'BUY' ? this.bidLevels : this.askLevels;
  }

  private getOrCreateLevel(side: Side, price: Decimal): PriceLevel {
    const key = price.toFixed();
    const map = this.levelMap(side);
    const existing = map.get(key);
    if (existing) return existing;
    const level: PriceLevel = { price, key, head: null, tail: null, total: ZERO, count: 0 };
    const arr = this.levels(side);
    // Binary search for insertion index (bids desc, asks asc).
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const cmp = arr[mid]!.price.comparedTo(price);
      const before = side === 'BUY' ? cmp > 0 : cmp < 0;
      if (before) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, level);
    map.set(key, level);
    return level;
  }

  private removeLevel(side: Side, level: PriceLevel): void {
    const arr = this.levels(side);
    const idx = arr.indexOf(level);
    if (idx >= 0) arr.splice(idx, 1);
    this.levelMap(side).delete(level.key);
  }

  private link(order: RestingOrder, level: PriceLevel): void {
    order.level = level;
    order.prev = level.tail;
    order.next = null;
    if (level.tail) level.tail.next = order;
    else level.head = order;
    level.tail = order;
    level.total = level.total.plus(order.remaining);
    level.count += 1;
  }

  private unlink(order: RestingOrder): void {
    const level = order.level;
    if (!level) return;
    if (order.prev) order.prev.next = order.next;
    else level.head = order.next;
    if (order.next) order.next.prev = order.prev;
    else level.tail = order.prev;
    level.total = level.total.minus(order.remaining);
    level.count -= 1;
    order.prev = null;
    order.next = null;
    order.level = null;
    if (level.count === 0) this.removeLevel(order.side, level);
  }

  // ───────── public mutations ─────────

  /**
   * Insert an order directly into the book (used when rebuilding from the database).
   * `seq` must be the order's persisted engine sequence so time priority survives restarts.
   */
  restore(o: { id: string; userId: string; side: Side; price: Decimal; remaining: Decimal; seq: number; reduceOnly?: boolean }): void {
    if (this.orders.has(o.id)) return;
    const order: RestingOrder = {
      ...o,
      reduceOnly: o.reduceOnly ?? false,
      prev: null,
      next: null,
      level: null,
    };
    this.link(order, this.getOrCreateLevel(o.side, o.price));
    this.orders.set(o.id, order);
    if (o.seq > this.orderSeq) this.orderSeq = o.seq;
  }

  /** Remove an order. Returns the removed order (with its remaining quantity) or undefined. */
  cancel(orderId: string): RestingOrder | undefined {
    const order = this.orders.get(orderId);
    if (!order) return undefined;
    this.unlink(order);
    this.orders.delete(orderId);
    return order;
  }

  /** Reduce remaining quantity in place, keeping time priority. */
  reduce(orderId: string, newRemaining: Decimal): boolean {
    const order = this.orders.get(orderId);
    if (!order || newRemaining.lte(0) || newRemaining.gt(order.remaining)) return false;
    const level = order.level!;
    level.total = level.total.minus(order.remaining).plus(newRemaining);
    order.remaining = newRemaining;
    return true;
  }

  /** Would a taker at `price` on `side` cross the book immediately? */
  wouldCross(side: Side, price: Decimal): boolean {
    const best = side === 'BUY' ? this.asks[0] : this.bids[0];
    if (!best) return false;
    return side === 'BUY' ? best.price.lte(price) : best.price.gte(price);
  }

  private crosses(t: TakerOrder, levelPrice: Decimal): 'OK' | 'PRICE_LIMIT' | 'NO' {
    if (t.kind === 'LIMIT') {
      const ok = t.side === 'BUY' ? levelPrice.lte(t.price!) : levelPrice.gte(t.price!);
      if (!ok) return 'NO';
    }
    if (t.priceLimit) {
      const ok = t.side === 'BUY' ? levelPrice.lte(t.priceLimit) : levelPrice.gte(t.priceLimit);
      if (!ok) return 'PRICE_LIMIT';
    }
    return 'OK';
  }

  /** Quantity a taker could fill right now (FOK pre-check). Self orders are excluded under STP. */
  private fillableQty(t: TakerOrder): Decimal {
    const opposite = t.side === 'BUY' ? this.asks : this.bids;
    const stp = t.stp ?? 'EXPIRE_MAKER';
    let qty = ZERO;
    let quote = ZERO;
    const target = t.quantity ?? null;
    for (const level of opposite) {
      if (this.crosses(t, level.price) !== 'OK') break;
      for (let o = level.head; o; o = o.next) {
        if (o.userId === t.userId && stp !== 'NONE') {
          if (stp === 'EXPIRE_TAKER') return qty;
          continue;
        }
        let take = o.remaining;
        if (t.maxQuote) {
          const affordable = floorToStep(t.maxQuote.minus(quote).div(level.price), this.step);
          take = dmin(take, affordable);
        }
        if (target) take = dmin(take, target.minus(qty));
        if (take.lte(0)) return qty;
        qty = qty.plus(take);
        quote = quote.plus(take.mul(level.price));
        if (target && qty.gte(target)) return qty;
      }
    }
    return qty;
  }

  /**
   * Match an incoming order against the book. Mutates the book (fills makers, rests the remainder
   * for GTC/GTX limit orders) and returns every fill in execution order.
   */
  match(t: TakerOrder): MatchResult {
    const result: MatchResult = {
      fills: [],
      expiredMakers: [],
      filledQty: ZERO,
      filledQuote: ZERO,
      remainingQty: t.quantity ?? ZERO,
      outcome: 'EXPIRED',
      stopReason: null,
    };
    if (this.orders.has(t.id)) {
      return { ...result, outcome: 'REJECTED', rejectReason: 'INVALID' };
    }
    if (t.kind === 'LIMIT' && (!t.price || t.price.lte(0))) return { ...result, outcome: 'REJECTED', rejectReason: 'INVALID' };
    if (!t.quantity && !t.quoteBudget) return { ...result, outcome: 'REJECTED', rejectReason: 'INVALID' };
    if (t.kind === 'LIMIT' && !t.quantity) return { ...result, outcome: 'REJECTED', rejectReason: 'INVALID' };

    // Post-only: never take liquidity.
    if (t.timeInForce === 'GTX' && t.kind === 'LIMIT' && this.wouldCross(t.side, t.price!)) {
      return { ...result, outcome: 'REJECTED', rejectReason: 'POST_ONLY_WOULD_TAKE' };
    }
    // Fill-or-kill: all or nothing, decided before touching the book.
    if (t.timeInForce === 'FOK' && t.quantity && this.fillableQty(t).lt(t.quantity)) {
      return { ...result, outcome: 'REJECTED', rejectReason: 'FOK_NOT_FILLABLE' };
    }

    const opposite = t.side === 'BUY' ? this.asks : this.bids;
    const stp = t.stp ?? 'EXPIRE_MAKER';
    let remaining = t.quantity ?? null;
    let budget = t.quoteBudget ?? null;
    let stop: StopReason;

    while (true) {
      if (remaining && remaining.lte(0)) {
        stop = 'FILLED';
        break;
      }
      const level = opposite[0];
      if (!level) {
        stop = 'NO_LIQUIDITY';
        break;
      }
      const cross = this.crosses(t, level.price);
      if (cross === 'NO') {
        stop = 'NO_LIQUIDITY';
        break;
      }
      if (cross === 'PRICE_LIMIT') {
        stop = 'PRICE_LIMIT';
        break;
      }
      const maker = level.head!;
      if (maker.userId === t.userId && stp !== 'NONE') {
        if (stp === 'EXPIRE_TAKER') {
          stop = 'SELF_TRADE';
          break;
        }
        this.unlink(maker);
        this.orders.delete(maker.id);
        result.expiredMakers.push({ orderId: maker.id, userId: maker.userId, remaining: maker.remaining });
        continue;
      }
      let qty = maker.remaining;
      if (remaining) qty = dmin(qty, remaining);
      if (budget) qty = dmin(qty, floorToStep(budget.div(level.price), this.step));
      if (t.maxQuote) qty = dmin(qty, floorToStep(t.maxQuote.minus(result.filledQuote).div(level.price), this.step));
      if (qty.lte(0)) {
        stop = 'BUDGET';
        break;
      }
      const quote = qty.mul(level.price);
      // Apply fill to maker.
      maker.remaining = maker.remaining.minus(qty);
      level.total = level.total.minus(qty);
      const makerDone = maker.remaining.isZero();
      this.tradeSeq += 1;
      result.fills.push({
        seq: this.tradeSeq,
        price: level.price,
        quantity: qty,
        quote,
        takerSide: t.side,
        takerOrderId: t.id,
        takerUserId: t.userId,
        makerOrderId: maker.id,
        makerUserId: maker.userId,
        makerRemaining: maker.remaining,
        makerDone,
      });
      if (makerDone) {
        // remaining is zero so unlink subtracts nothing further from level.total
        this.unlink(maker);
        this.orders.delete(maker.id);
      }
      result.filledQty = result.filledQty.plus(qty);
      result.filledQuote = result.filledQuote.plus(quote);
      if (remaining) remaining = remaining.minus(qty);
      if (budget) budget = budget.minus(quote);
    }

    result.stopReason = stop;
    result.remainingQty = remaining ?? ZERO;

    const fullyFilled = remaining ? remaining.lte(0) : stop === 'BUDGET' && result.filledQty.gt(0);
    if (fullyFilled) {
      result.outcome = 'FILLED';
      result.remainingQty = ZERO;
      return result;
    }

    const canRest =
      t.kind === 'LIMIT' && (t.timeInForce === 'GTC' || t.timeInForce === 'GTX') && stop !== 'SELF_TRADE' && remaining && remaining.gt(0);
    if (canRest) {
      this.orderSeq += 1;
      const order: RestingOrder = {
        id: t.id,
        userId: t.userId,
        side: t.side,
        price: t.price!,
        remaining: remaining!,
        seq: this.orderSeq,
        reduceOnly: t.reduceOnly ?? false,
        prev: null,
        next: null,
        level: null,
      };
      this.link(order, this.getOrCreateLevel(t.side, t.price!));
      this.orders.set(order.id, order);
      result.outcome = 'RESTING';
      result.rested = { price: t.price!, remaining: remaining!, seq: this.orderSeq };
      return result;
    }

    result.outcome = 'EXPIRED';
    if (result.fills.length === 0 && t.kind === 'MARKET' && stop === 'NO_LIQUIDITY') result.rejectReason = 'NO_LIQUIDITY';
    return result;
  }

  /** Aggregated depth, optionally grouped into price buckets of `groupStep`. */
  depth(limit = 50, groupStep?: string): DepthSnapshot {
    const agg = (levels: PriceLevel[], side: Side): [string, string][] => {
      if (!groupStep || D(groupStep).lte(this.config.tickSize)) {
        return levels.slice(0, limit).map((l) => [l.price.toFixed(), l.total.toFixed()]);
      }
      const g = D(groupStep);
      const out = new Map<string, Decimal>();
      for (const l of levels) {
        const bucket = side === 'BUY' ? l.price.div(g).floor().mul(g) : l.price.div(g).ceil().mul(g);
        const k = bucket.toFixed();
        out.set(k, (out.get(k) ?? ZERO).plus(l.total));
        if (out.size > limit) break;
      }
      return [...out.entries()].slice(0, limit).map(([p, q]) => [p, q.toFixed()]);
    };
    return { bids: agg(this.bids, 'BUY'), asks: agg(this.asks, 'SELL') };
  }

  /** Sum of liquidity on one side within `levels` (diagnostics / market-order estimation). */
  estimateCost(side: Side, quantity: Decimal): { quote: Decimal; filled: Decimal; worstPrice: Decimal | null } {
    const opposite = side === 'BUY' ? this.asks : this.bids;
    let filled = ZERO;
    let quote = ZERO;
    let worst: Decimal | null = null;
    for (const l of opposite) {
      const take = dmin(l.total, quantity.minus(filled));
      if (take.lte(0)) break;
      filled = filled.plus(take);
      quote = quote.plus(take.mul(l.price));
      worst = l.price;
    }
    return { quote, filled, worstPrice: worst };
  }

  /** Verify internal consistency (used by tests and debug endpoints). */
  checkInvariants(): void {
    const check = (levels: PriceLevel[], side: Side) => {
      for (let i = 0; i < levels.length; i++) {
        const l = levels[i]!;
        if (i > 0) {
          const prev = levels[i - 1]!;
          const ordered = side === 'BUY' ? prev.price.gt(l.price) : prev.price.lt(l.price);
          if (!ordered) throw new Error(`${side} levels out of order at ${l.key}`);
        }
        let total = ZERO;
        let count = 0;
        let lastSeq = -Infinity;
        for (let o = l.head; o; o = o.next) {
          if (o.remaining.lte(0)) throw new Error(`order ${o.id} has non-positive remaining`);
          if (o.seq <= lastSeq) throw new Error(`time priority violated at level ${l.key}`);
          lastSeq = o.seq;
          total = total.plus(o.remaining);
          count += 1;
        }
        if (!total.eq(l.total) || count !== l.count) throw new Error(`level ${l.key} totals inconsistent`);
      }
    };
    check(this.bids, 'BUY');
    check(this.asks, 'SELL');
    const best = { bid: this.bids[0]?.price, ask: this.asks[0]?.price };
    if (best.bid && best.ask && best.bid.gte(best.ask)) throw new Error('book is crossed');
  }
}
