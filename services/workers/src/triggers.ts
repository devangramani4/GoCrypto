import type { OrderSide, OrderType } from '@gocrypto/shared-types';
import { type Core, type EngineGateway, STREAMS, StreamConsumer, type TradeStreamEntry } from '@gocrypto/server-core';
import { D, type Decimal } from '@gocrypto/trading-utils';
import { triggerCondition } from '@gocrypto/risk-engine';

interface Pending {
  id: string;
  userId: string;
  marketId: number;
  type: OrderType;
  side: OrderSide;
  stop: Decimal;
  working: 'MARK_PRICE' | 'LAST_PRICE';
}

/** Per-market thresholds kept sorted so each price tick only touches orders that actually fire. */
class MarketTriggers {
  /** Fire when price >= stop (ascending by stop). */
  gte: Pending[] = [];
  /** Fire when price <= stop (descending by stop). */
  lte: Pending[] = [];

  add(p: Pending): void {
    const list = triggerCondition(p.type, p.side) === 'GTE' ? this.gte : this.lte;
    const asc = list === this.gte;
    let i = list.findIndex((x) => (asc ? x.stop.gt(p.stop) : x.stop.lt(p.stop)));
    if (i === -1) i = list.length;
    list.splice(i, 0, p);
  }

  remove(id: string): void {
    this.gte = this.gte.filter((p) => p.id !== id);
    this.lte = this.lte.filter((p) => p.id !== id);
  }

  due(price: Decimal, source: 'MARK_PRICE' | 'LAST_PRICE'): Pending[] {
    const out: Pending[] = [];
    for (const p of this.gte) {
      if (p.stop.gt(price)) break;
      if (p.working === source) out.push(p);
    }
    for (const p of this.lte) {
      if (p.stop.lt(price)) break;
      if (p.working === source) out.push(p);
    }
    return out;
  }

  get size(): number {
    return this.gte.length + this.lte.length;
  }
}

/**
 * Stop-loss / take-profit / stop-limit triggering. Funds were reserved when the order was placed;
 * firing atomically flips trigger_state PENDING -> TRIGGERED (so a concurrent cancel and trigger
 * can never both win) and hands the order to the matching engine.
 */
export class TriggerMonitor {
  private readonly markets = new Map<number, MarketTriggers>();
  private readonly index = new Map<string, number>();
  private consumer: StreamConsumer<TradeStreamEntry> | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly core: Core,
    private readonly engine: EngineGateway,
  ) {}

  async start(): Promise<void> {
    await this.reload();
    this.core.events.on('order.trigger', async ({ action, orderId }) => {
      if (action === 'removed') return this.remove(orderId);
      await this.load(orderId);
    });
    this.core.events.on('price.mark', (p) => void this.onPrice(p.marketId, D(p.markPrice), 'MARK_PRICE'));
    await this.core.events.start();
    this.consumer = new StreamConsumer<TradeStreamEntry>(
      this.core.redis.blocking('trades-triggers'),
      STREAMS.trades,
      'workers-triggers',
      'workers',
      async (messages) => {
        const last = new Map<number, string>();
        for (const m of messages) last.set(m.data.marketId, m.data.price);
        for (const [marketId, price] of last) await this.onPrice(marketId, D(price), 'LAST_PRICE');
      },
      { batch: 1000, blockMs: 1000, startId: '$' },
    );
    await this.consumer.start();
    this.reloadTimer = setInterval(() => void this.reload(), 60_000);
  }

  async stop(): Promise<void> {
    if (this.reloadTimer) clearInterval(this.reloadTimer);
    await this.consumer?.stop();
  }

  get size(): number {
    let n = 0;
    for (const m of this.markets.values()) n += m.size;
    return n;
  }

  private add(p: Pending): void {
    if (this.index.has(p.id)) this.remove(p.id);
    const m = this.markets.get(p.marketId) ?? new MarketTriggers();
    m.add(p);
    this.markets.set(p.marketId, m);
    this.index.set(p.id, p.marketId);
  }

  private remove(id: string): void {
    const mid = this.index.get(id);
    if (mid === undefined) return;
    this.markets.get(mid)?.remove(id);
    this.index.delete(id);
  }

  private rowToPending(r: { id: string; user_id: string; market_id: number; type: OrderType; side: OrderSide; stop_price: string; working_type: 'MARK_PRICE' | 'LAST_PRICE'; market_type: string }): Pending {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      marketId: Number(r.market_id),
      type: r.type,
      side: r.side,
      stop: D(r.stop_price),
      // Spot has no mark price; futures follow the order's working type.
      working: r.market_type === 'FUTURES' ? r.working_type : 'LAST_PRICE',
    };
  }

  async reload(): Promise<void> {
    const rows = await this.core.db.query<Parameters<TriggerMonitor['rowToPending']>[0]>(
      "SELECT id, user_id, market_id, type, side, stop_price, working_type, market_type FROM orders WHERE status = 'NEW' AND trigger_state = 'PENDING'",
    );
    this.markets.clear();
    this.index.clear();
    for (const r of rows) this.add(this.rowToPending(r));
  }

  private async load(orderId: string): Promise<void> {
    const r = await this.core.db.one<Parameters<TriggerMonitor['rowToPending']>[0]>(
      "SELECT id, user_id, market_id, type, side, stop_price, working_type, market_type FROM orders WHERE id = ? AND status = 'NEW' AND trigger_state = 'PENDING'",
      [orderId],
    );
    if (r) this.add(this.rowToPending(r));
  }

  async onPrice(marketId: number, price: Decimal, source: 'MARK_PRICE' | 'LAST_PRICE'): Promise<void> {
    const m = this.markets.get(marketId);
    if (!m) return;
    for (const p of m.due(price, source)) {
      this.remove(p.id);
      const res = await this.core.db.execute(
        "UPDATE orders SET trigger_state = 'TRIGGERED', triggered_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'NEW' AND trigger_state = 'PENDING'",
        [p.id],
      );
      if (res.affectedRows !== 1) continue; // cancelled or already triggered
      await this.core.orders.addHistory(this.core.db, [
        { orderId: p.id, userId: p.userId, event: 'TRIGGERED', status: 'NEW', details: { price: price.toFixed(), source } },
      ]).catch(() => undefined);
      await this.engine.submit({ kind: 'NEW', orderId: p.id, marketId }, { awaitResult: false });
      this.core.log.info({ orderId: p.id, price: price.toFixed(), source }, 'trigger order fired');
    }
  }
}
