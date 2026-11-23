import type {
  FillDto,
  MarginMode,
  MarketType,
  OrderDto,
  OrderSide,
  OrderSource,
  OrderStatus,
  OrderType,
  TimeInForce,
  TriggerState,
} from '@gocrypto/shared-types';
import { D, toPlain } from '@gocrypto/trading-utils';
import type { Core } from '../core';
import { type Executor, type Tx, placeholders, toMsStrict } from '../db/database';

export interface OrderRow {
  id: string;
  user_id: string;
  market_id: number;
  market_type: MarketType;
  client_order_id: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  status: OrderStatus;
  trigger_state: TriggerState;
  working_type: 'MARK_PRICE' | 'LAST_PRICE';
  price: string | null;
  stop_price: string | null;
  quantity: string | null;
  quote_quantity: string | null;
  filled_quantity: string;
  filled_quote: string;
  fee_total: string;
  fee_asset_id: number | null;
  reduce_only: boolean;
  post_only: boolean;
  close_position: boolean;
  leverage: number | null;
  margin_mode: MarginMode | null;
  lock_asset_id: number | null;
  locked_amount: string;
  oco_group_id: string | null;
  parent_order_id: string | null;
  engine_seq: string | null;
  reject_reason: string | null;
  source: OrderSource;
  created_at: Date;
  updated_at: Date;
  triggered_at: Date | null;
  done_at: Date | null;
}

export interface NewOrderInput {
  userId: string;
  marketId: number;
  marketType: MarketType;
  clientOrderId: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  triggerState: TriggerState;
  workingType?: 'MARK_PRICE' | 'LAST_PRICE';
  price: string | null;
  stopPrice: string | null;
  quantity: string | null;
  quoteQuantity: string | null;
  reduceOnly?: boolean;
  postOnly?: boolean;
  closePosition?: boolean;
  leverage?: number | null;
  marginMode?: MarginMode | null;
  lockAssetId: number | null;
  lockedAmount: string;
  ocoGroupId?: string | null;
  parentOrderId?: string | null;
  source: OrderSource;
}

export const OPEN_STATUSES: OrderStatus[] = ['NEW', 'OPEN', 'PARTIALLY_FILLED'];

export class OrderRepository {
  constructor(private readonly core: Core) {}

  async insert(exec: Executor, o: NewOrderInput): Promise<string> {
    const res = await exec.execute(
      `INSERT INTO orders (user_id, market_id, market_type, client_order_id, side, type, time_in_force, status, trigger_state,
         working_type, price, stop_price, quantity, quote_quantity, reduce_only, post_only, close_position, leverage, margin_mode,
         lock_asset_id, locked_amount, oco_group_id, parent_order_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        o.userId,
        o.marketId,
        o.marketType,
        o.clientOrderId,
        o.side,
        o.type,
        o.timeInForce,
        o.triggerState,
        o.workingType ?? 'LAST_PRICE',
        o.price,
        o.stopPrice,
        o.quantity,
        o.quoteQuantity,
        o.reduceOnly ? 1 : 0,
        o.postOnly ? 1 : 0,
        o.closePosition ? 1 : 0,
        o.leverage ?? null,
        o.marginMode ?? null,
        o.lockAssetId,
        o.lockedAmount,
        o.ocoGroupId ?? null,
        o.parentOrderId ?? null,
        o.source,
      ],
    );
    return res.insertId;
  }

  find(id: string, exec: Executor = this.core.db): Promise<OrderRow | null> {
    return exec.one<OrderRow>('SELECT * FROM orders WHERE id = ?', [id]);
  }

  findForUser(userId: string, id: string): Promise<OrderRow | null> {
    return this.core.db.one<OrderRow>('SELECT * FROM orders WHERE id = ? AND user_id = ?', [id, userId]);
  }

  findByClientId(userId: string, clientOrderId: string, exec: Executor = this.core.db): Promise<OrderRow | null> {
    return exec.one<OrderRow>('SELECT * FROM orders WHERE user_id = ? AND client_order_id = ?', [userId, clientOrderId]);
  }

  lock(tx: Tx, id: string): Promise<OrderRow | null> {
    return tx.one<OrderRow>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
  }

  /** Lock several orders in id order (deadlock-safe). */
  async lockMany(tx: Tx, ids: string[]): Promise<Map<string, OrderRow>> {
    const uniq = [...new Set(ids)].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    const out = new Map<string, OrderRow>();
    if (!uniq.length) return out;
    const rows = await tx.query<OrderRow>(`SELECT * FROM orders WHERE id IN (${placeholders(uniq.length)}) ORDER BY id FOR UPDATE`, uniq);
    for (const r of rows) out.set(String(r.id), r);
    return out;
  }

  async addHistory(exec: Executor, rows: { orderId: string; userId: string; event: string; status: OrderStatus; details?: unknown }[]) {
    if (!rows.length) return;
    await exec.execute(
      `INSERT INTO order_history (order_id, user_id, event, status_after, details) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
      rows.flatMap((r) => [r.orderId, r.userId, r.event, r.status, r.details ? JSON.stringify(r.details) : null]),
    );
  }

  async openOrders(userId: string, opts: { marketType?: MarketType; marketId?: number } = {}): Promise<OrderRow[]> {
    const where = ["user_id = ?", "status IN ('NEW','OPEN','PARTIALLY_FILLED')"];
    const params: unknown[] = [userId];
    if (opts.marketType) {
      where.push('market_type = ?');
      params.push(opts.marketType);
    }
    if (opts.marketId) {
      where.push('market_id = ?');
      params.push(opts.marketId);
    }
    return this.core.db.query<OrderRow>(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`, params);
  }

  async countOpen(userId: string): Promise<number> {
    const r = await this.core.db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
      [userId],
    );
    return Number(r?.c ?? 0);
  }

  async history(
    userId: string,
    q: { cursor?: string; limit: number; marketType?: MarketType; marketId?: number; status?: OrderStatus; side?: OrderSide; from?: number; to?: number },
  ): Promise<{ items: OrderRow[]; nextCursor: string | null }> {
    const where = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (q.cursor) {
      where.push('id < ?');
      params.push(q.cursor);
    }
    if (q.marketType) {
      where.push('market_type = ?');
      params.push(q.marketType);
    }
    if (q.marketId) {
      where.push('market_id = ?');
      params.push(q.marketId);
    }
    if (q.status) {
      where.push('status = ?');
      params.push(q.status);
    }
    if (q.side) {
      where.push('side = ?');
      params.push(q.side);
    }
    if (q.from) {
      where.push('created_at >= ?');
      params.push(new Date(q.from));
    }
    if (q.to) {
      where.push('created_at <= ?');
      params.push(new Date(q.to));
    }
    params.push(q.limit + 1);
    const rows = await this.core.db.query<OrderRow>(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, params);
    const page = rows.slice(0, q.limit);
    return { items: page, nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null };
  }

  async fills(
    userId: string,
    q: { cursor?: string; limit: number; marketType?: MarketType; marketId?: number; orderId?: string; from?: number; to?: number },
  ): Promise<{ items: FillDto[]; nextCursor: string | null }> {
    const where = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (q.cursor) {
      where.push('id < ?');
      params.push(q.cursor);
    }
    if (q.marketType) {
      where.push('market_type = ?');
      params.push(q.marketType);
    }
    if (q.marketId) {
      where.push('market_id = ?');
      params.push(q.marketId);
    }
    if (q.orderId) {
      where.push('order_id = ?');
      params.push(q.orderId);
    }
    if (q.from) {
      where.push('created_at >= ?');
      params.push(new Date(q.from));
    }
    if (q.to) {
      where.push('created_at <= ?');
      params.push(new Date(q.to));
    }
    params.push(q.limit + 1);
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT * FROM order_fills WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      params,
    );
    const page = rows.slice(0, q.limit);
    return { items: page.map((r) => this.fillDto(r)), nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null };
  }

  fillDto(r: Record<string, unknown>): FillDto {
    const market = this.core.markets.byId(Number(r.market_id));
    return {
      id: String(r.id),
      orderId: String(r.order_id),
      tradeId: String(r.trade_id),
      symbol: market?.symbol ?? String(r.market_id),
      marketType: r.market_type as MarketType,
      side: r.side as OrderSide,
      isMaker: Boolean(r.is_maker),
      price: toPlain(String(r.price)),
      qty: toPlain(String(r.quantity)),
      quoteQty: toPlain(String(r.quote_quantity)),
      fee: toPlain(String(r.fee)),
      feeAsset: this.core.assets.symbolOf(Number(r.fee_asset_id)),
      realizedPnl: r.realized_pnl == null ? null : toPlain(String(r.realized_pnl)),
      ts: toMsStrict(r.created_at),
    };
  }

  toDto(r: OrderRow): OrderDto {
    const market = this.core.markets.byId(Number(r.market_id));
    const filled = D(r.filled_quantity);
    return {
      id: String(r.id),
      clientOrderId: r.client_order_id,
      symbol: market?.symbol ?? String(r.market_id),
      marketType: r.market_type,
      side: r.side,
      type: r.type,
      timeInForce: r.time_in_force,
      status: r.status,
      triggerState: r.trigger_state,
      price: r.price == null ? null : toPlain(r.price),
      stopPrice: r.stop_price == null ? null : toPlain(r.stop_price),
      quantity: r.quantity == null ? null : toPlain(r.quantity),
      quoteQuantity: r.quote_quantity == null ? null : toPlain(r.quote_quantity),
      filledQuantity: toPlain(r.filled_quantity),
      filledQuote: toPlain(r.filled_quote),
      avgPrice: filled.gt(0) ? D(r.filled_quote).div(filled).toDecimalPlaces(12).toFixed() : null,
      feeTotal: toPlain(r.fee_total),
      feeAsset: r.fee_asset_id == null ? null : this.core.assets.symbolOf(Number(r.fee_asset_id)),
      reduceOnly: Boolean(r.reduce_only),
      postOnly: Boolean(r.post_only),
      closePosition: Boolean(r.close_position),
      leverage: r.leverage == null ? null : Number(r.leverage),
      marginMode: r.margin_mode,
      ocoGroupId: r.oco_group_id == null ? null : String(r.oco_group_id),
      rejectReason: r.reject_reason,
      source: r.source,
      createdAt: toMsStrict(r.created_at),
      updatedAt: toMsStrict(r.updated_at),
    };
  }
}
