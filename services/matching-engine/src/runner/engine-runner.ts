import type { OrderDto, OrderStatus, PublicTradeDto } from '@gocrypto/shared-types';
import { marketChannel, userChannel } from '@gocrypto/shared-types';
import {
  AppError,
  type Core,
  type EngineCommand,
  type EngineResult,
  type MarketInfo,
  type OrderRow,
  PriceService,
  STREAMS,
  futuresReserve,
  metrics,
  optionsReserve,
  spotReserve,
} from '@gocrypto/server-core';
import { D, type Decimal, ONE, ZERO, dmin, floorToStep, q18, toDb, validateLimitOrder } from '@gocrypto/trading-utils';
import { OrderBook, type Side, type TakerOrder } from '../engine/order-book';
import { BalanceSim } from '../settlement/balance-sim';
import {
  AlreadyProcessedError,
  type OrderState,
  Settlement,
  type SettleOutput,
  orderState,
} from '../settlement/settlement';

export interface RunnerOptions {
  /** Market-data publish interval: depth snapshots (changed books only) and coalesced public trades. */
  depthIntervalMs?: number;
  depthLevels?: number;
  /** Re-submit accepted-but-unprocessed orders older than this (ms). */
  orphanAgeMs?: number;
  sweepIntervalMs?: number;
  /** Markets served by this instance (engine sharding); all markets when omitted. */
  owns?: (marketId: number) => boolean;
}

const OPEN: OrderStatus[] = ['NEW', 'OPEN', 'PARTIALLY_FILLED'];
const MARKET_TYPES = new Set(['MARKET', 'STOP_MARKET', 'TAKE_PROFIT_MARKET']);

function fail(code: AppError['code'], message: string, orderId?: string): EngineResult {
  return { ok: false, orderId, error: { code, message } };
}

/** Rebuild an OrderRow from a settled state (for DTO publication). */
function rowOf(o: OrderState): OrderRow {
  return {
    ...o.row,
    status: o.status,
    quantity: o.quantity ? o.quantity.toFixed() : o.row.quantity,
    filled_quantity: o.filledQty.toFixed(),
    filled_quote: o.filledQuote.toFixed(),
    fee_total: o.feeTotal.toFixed(),
    fee_asset_id: o.feeAssetId,
    locked_amount: o.locked.toFixed(),
    reject_reason: o.rejectReason,
    updated_at: new Date(),
  };
}

/**
 * Hosts one order book per market and processes engine commands. Commands for the same market are
 * strictly serialized (single writer per book); different markets proceed in parallel.
 * The database is the source of truth: on any settlement failure the book is rebuilt from it.
 */
export class EngineRunner {
  private readonly books = new Map<number, OrderBook>();
  private readonly loading = new Map<number, Promise<OrderBook>>();
  private readonly chains = new Map<number, Promise<unknown>>();
  private readonly pending = new Map<number, number>();
  private readonly dirty = new Set<number>();
  /** Public trades awaiting the next publish tick, oldest first (one WebSocket message per market per tick). */
  private readonly pendingTrades = new Map<number, { symbol: string; trades: PublicTradeDto[] }>();
  private depthTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  readonly settlement: Settlement;

  constructor(
    private readonly core: Core,
    private readonly opts: RunnerOptions = {},
  ) {
    this.settlement = new Settlement(core);
  }

  /** Whether this instance is the single writer for a market's book. */
  owns(marketId: number): boolean {
    return this.opts.owns ? this.opts.owns(marketId) : true;
  }

  async start(): Promise<void> {
    for (const m of this.core.markets.list()) {
      if (m.status === 'TRADING' && this.owns(m.id)) await this.getBook(m);
    }
    this.depthTimer = setInterval(
      () => void this.publishDepth(),
      this.opts.depthIntervalMs ?? this.core.config.ENGINE_PUBLISH_INTERVAL_MS,
    );
    this.depthTimer.unref();
    this.sweepTimer = setInterval(() => {
      this.sweepOrphans(this.opts.orphanAgeMs ?? 5000).catch((e) =>
        this.core.log.error({ err: e }, 'orphan sweep failed'),
      );
    }, this.opts.sweepIntervalMs ?? 15_000);
    this.sweepTimer.unref();
    await this.sweepOrphans(0);
    this.core.log.info({ books: this.books.size }, 'matching engine started');
  }

  async stop(): Promise<void> {
    if (this.depthTimer) clearInterval(this.depthTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await Promise.allSettled([...this.chains.values()]);
    await this.publishDepth();
  }

  /** Wait until every queued command has been processed (tests, graceful shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }

  book(marketId: number): OrderBook | undefined {
    return this.books.get(marketId);
  }

  stats(): { markets: number; orders: number; queued: number } {
    let orders = 0;
    for (const b of this.books.values()) orders += b.size;
    let queued = 0;
    for (const n of this.pending.values()) queued += n;
    return { markets: this.books.size, orders, queued };
  }

  // ───────────────────────── book lifecycle ─────────────────────────

  private async getBook(market: MarketInfo): Promise<OrderBook> {
    const existing = this.books.get(market.id);
    if (existing) return existing;
    let p = this.loading.get(market.id);
    if (!p) {
      p = this.loadBook(market).finally(() => this.loading.delete(market.id));
      this.loading.set(market.id, p);
    }
    return p;
  }

  async loadBook(market: MarketInfo): Promise<OrderBook> {
    const rows = await this.core.db.query<{
      id: string;
      user_id: string;
      side: Side;
      price: string;
      quantity: string;
      filled_quantity: string;
      engine_seq: string | null;
      reduce_only: boolean;
    }>(
      `SELECT id, user_id, side, price, quantity, filled_quantity, engine_seq, reduce_only FROM orders
        WHERE market_id = ? AND status IN ('OPEN','PARTIALLY_FILLED') ORDER BY engine_seq, id`,
      [market.id],
    );
    const seqs = await this.core.db.one<{ t: string; o: string }>(
      `SELECT (SELECT COALESCE(MAX(seq), 0) FROM trades WHERE market_id = ?) AS t,
              (SELECT COALESCE(MAX(engine_seq), 0) FROM orders WHERE market_id = ?) AS o`,
      [market.id, market.id],
    );
    const book = new OrderBook(
      { symbol: market.symbol, tickSize: market.tickSize, stepSize: market.stepSize },
      { tradeSeq: Number(seqs?.t ?? 0), orderSeq: Number(seqs?.o ?? 0) },
    );
    for (const r of rows) {
      const remaining = D(r.quantity).minus(r.filled_quantity);
      if (remaining.lte(0) || !r.price) continue;
      book.restore({
        id: String(r.id),
        userId: String(r.user_id),
        side: r.side,
        price: D(r.price),
        remaining,
        seq: Number(r.engine_seq ?? 0),
        reduceOnly: Boolean(r.reduce_only),
      });
    }
    this.books.set(market.id, book);
    this.dirty.add(market.id);
    return book;
  }

  // ───────────────────────── command intake ─────────────────────────

  submit(cmd: EngineCommand): Promise<EngineResult> {
    const mid = cmd.marketId;
    if (!this.owns(mid)) {
      // Misrouted (producer configured with a different shard layout): never touch another shard's book.
      this.core.log.error({ cmd }, 'engine command for a market owned by another shard');
      return Promise.resolve(fail('SERVICE_UNAVAILABLE', 'Market is served by another engine shard'));
    }
    this.pending.set(mid, (this.pending.get(mid) ?? 0) + 1);
    const prev = this.chains.get(mid) ?? Promise.resolve();
    const run = prev.then(() => this.process(cmd));
    const result = run
      .catch((e: unknown): EngineResult => {
        this.core.log.error({ err: e, cmd }, 'engine command crashed');
        return fail('INTERNAL_ERROR', 'Engine error');
      })
      .finally(() => {
        this.pending.set(mid, Math.max(0, (this.pending.get(mid) ?? 1) - 1));
      });
    this.chains.set(
      mid,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private async process(cmd: EngineCommand): Promise<EngineResult> {
    const end = metrics.engineCommandDuration.startTimer({ command: cmd.kind });
    try {
      switch (cmd.kind) {
        case 'NEW':
          return await this.handleNew(cmd.orderId);
        case 'CANCEL':
          return await this.handleCancel(cmd.orderId, cmd.userId, cmd.reason ?? 'USER');
        case 'CANCEL_ALL':
          return await this.handleCancelAll(cmd.marketId, cmd.userId, cmd.reason ?? 'USER');
        case 'AMEND':
          return await this.handleAmend(cmd);
        case 'RELOAD': {
          const m = this.core.markets.byId(cmd.marketId);
          if (!m) return fail('MARKET_NOT_FOUND', 'Unknown market');
          await this.loadBook(m);
          return { ok: true };
        }
      }
    } finally {
      end();
    }
  }

  // ───────────────────────── NEW ─────────────────────────

  private async handleNew(orderId: string): Promise<EngineResult> {
    let row = await this.core.orders.find(orderId);
    if (!row) return fail('ORDER_NOT_FOUND', 'Order not found', orderId);
    if (row.status !== 'NEW' || row.trigger_state === 'PENDING') return { ok: true, orderId, status: row.status };
    const market = this.core.markets.byId(Number(row.market_id));
    if (!market) {
      await this.rejectAndPublish(orderId, 'MARKET_NOT_FOUND');
      return fail('MARKET_NOT_FOUND', 'Market not found', orderId);
    }
    const now = Date.now();
    if (market.status !== 'TRADING' || (market.option && market.option.expiryAt <= now)) {
      await this.rejectAndPublish(orderId, 'MARKET_CLOSED');
      return fail('MARKET_CLOSED', `${market.symbol} is not open for trading`, orderId);
    }
    const book = await this.getBook(market);

    if (row.oco_group_id && row.trigger_state === 'TRIGGERED') {
      row = (await this.activateOcoStopLeg(row, book, market)) ?? row;
    }

    // Resolve the executable quantity (reduce-only / close-position are capped by the live position).
    let qty: Decimal | null = row.quantity ? D(row.quantity) : null;
    if ((market.type === 'FUTURES' || market.type === 'OPTIONS') && (row.reduce_only || row.close_position)) {
      const table = market.type === 'FUTURES' ? 'futures_positions' : 'options_positions';
      const pos = await this.core.db.one<{ side: 'LONG' | 'SHORT' | null; quantity: string }>(
        `SELECT side, quantity FROM ${table} WHERE user_id = ? AND market_id = ?`,
        [row.user_id, market.id],
      );
      const closes =
        pos?.side && D(pos.quantity).gt(0) && (pos.side === 'LONG' ? row.side === 'SELL' : row.side === 'BUY');
      const closable = closes ? D(pos!.quantity) : ZERO;
      qty = floorToStep(row.close_position || !qty ? closable : dmin(qty, closable), market.stepSize);
      if (qty.lte(0)) {
        await this.rejectAndPublish(orderId, 'REDUCE_ONLY_REJECTED', 'EXPIRED');
        return fail('REDUCE_ONLY_REJECTED', 'No position to reduce', orderId);
      }
    }

    const isMarket = MARKET_TYPES.has(row.type);
    const taker: TakerOrder = {
      id: String(row.id),
      userId: String(row.user_id),
      side: row.side,
      kind: isMarket ? 'MARKET' : 'LIMIT',
      price: row.price && !isMarket ? D(row.price) : undefined,
      quantity: qty ?? undefined,
      quoteBudget: !qty && row.quote_quantity ? D(row.quote_quantity) : undefined,
      maxQuote: market.type === 'SPOT' && row.side === 'BUY' ? D(row.locked_amount) : undefined,
      timeInForce: isMarket ? 'IOC' : row.time_in_force,
      priceLimit: isMarket ? this.protectionPrice(book, market, row.side) : undefined,
      stp: 'EXPIRE_MAKER',
      reduceOnly: Boolean(row.reduce_only),
    };

    let indexPrice: Decimal | null = null;
    let optionMark: Decimal | null = null;
    if (market.type === 'OPTIONS' && market.option) {
      const idx = await this.core.options.indexFor(market.option.underlying);
      if (idx) {
        indexPrice = D(idx);
        optionMark = this.core.options.markFor(
          market,
          idx,
          await this.core.options.baseIv(market.option.underlying),
        ).mark;
      }
    }

    const result = book.match(taker);
    let out: SettleOutput;
    try {
      out = await this.settlement.settleMatch({
        market,
        takerId: String(row.id),
        takerQty: qty,
        result,
        indexPrice,
        optionMark,
      });
    } catch (e) {
      return this.recover(market, String(row.id), e);
    }
    // Committed: from here on the order has executed, whatever happens while publishing.
    await this.afterSettleSafe(market, out);
    const t = out.orders.find((o) => o.row.id === String(row.id));
    return { ok: true, orderId, status: t?.status ?? row.status };
  }

  private protectionPrice(book: OrderBook, market: MarketInfo, side: Side): Decimal | undefined {
    const best = side === 'BUY' ? book.bestAsk() : book.bestBid();
    if (!best) return undefined;
    const band = D(market.priceBand);
    return side === 'BUY' ? best.price.mul(ONE.plus(band)) : best.price.mul(ONE.minus(band));
  }

  private async recover(market: MarketInfo, takerId: string, e: unknown): Promise<EngineResult> {
    metrics.settlementFailures.inc({ market_type: market.type });
    await this.loadBook(market);
    if (e instanceof AlreadyProcessedError) {
      const row = await this.core.orders.find(takerId);
      return { ok: true, orderId: takerId, status: row?.status };
    }
    this.core.log.error({ err: e, takerId, market: market.symbol }, 'settlement failed; book reloaded from database');
    await this.rejectAndPublish(takerId, 'SETTLEMENT_FAILED');
    const code = e instanceof AppError ? e.code : 'INTERNAL_ERROR';
    return fail(code, e instanceof AppError ? e.message : 'Order could not be settled', takerId);
  }

  private async rejectAndPublish(orderId: string, reason: string, status: OrderStatus = 'REJECTED'): Promise<void> {
    const o = await this.settlement.rejectOrder(orderId, reason, status).catch((err) => {
      this.core.log.error({ err, orderId }, 'failed to reject order');
      return null;
    });
    if (o) this.publishOrders([o]);
  }

  // ───────────────────────── after settlement ─────────────────────────

  /**
   * Post-commit work for a settled command. The settlement is already durable, so a failure here (Redis
   * hiccup, a follow-up OCO / reduce-only cancel) is logged and the book is re-synchronised from the
   * database instead of reporting the executed order as failed.
   */
  private async afterSettleSafe(market: MarketInfo, out: SettleOutput): Promise<void> {
    try {
      await this.afterSettle(market, out);
    } catch (e) {
      this.core.log.error(
        { err: e, market: market.symbol },
        'post-settlement processing failed; reloading book from database',
      );
      await this.loadBook(market).catch((err: unknown) =>
        this.core.log.error({ err, market: market.symbol }, 'book reload failed'),
      );
    }
  }

  private async afterSettle(market: MarketInfo, out: SettleOutput): Promise<void> {
    this.dirty.add(market.id);
    const sys = (id: string) => this.core.users.isSystemUserCached(id);
    if (out.records.length) {
      metrics.tradesTotal.inc({ market_type: market.type }, out.records.length);
      const { trades, stream } = Settlement.publicTrades(market, out.records);
      // Public trades are coalesced per market and go out with the next publish tick, so a busy market
      // costs each subscriber at most one trades frame per tick instead of one per match.
      const pending = this.pendingTrades.get(market.id);
      if (pending) pending.trades.push(...trades);
      else this.pendingTrades.set(market.id, { symbol: market.symbol, trades: [...trades] });
      // Recent-trades list + durable trade stream in one round trip; commands on one connection keep
      // their order, so the market's command chain does not wait for it.
      const pipe = this.core.redis.pub.pipeline();
      const listKey = PriceService.tradesKey(market.symbol);
      // LPUSH inserts left to right: pushing oldest→newest leaves the newest trade at the head.
      pipe.lpush(listKey, ...trades.map((t) => JSON.stringify(t)));
      pipe.ltrim(listKey, 0, 199);
      for (const s of stream) this.core.bus.appendStreamTo(pipe, STREAMS.trades, s);
      pipe
        .exec()
        .then((res) => {
          const err = res?.find(([e]) => e)?.[0];
          if (err) this.core.log.warn({ err, market: market.symbol }, 'trade publish failed');
        })
        .catch((err: unknown) => this.core.log.warn({ err, market: market.symbol }, 'trade publish failed'));
      for (const { user, dto } of Settlement.fillDtos(this.core, market, out.records)) {
        if (!sys(user)) this.core.bus.ws(userChannel(user, 'trades'), 'fill', dto);
      }
    }
    this.publishOrders(out.orders);

    // OCO: any execution of one leg cancels its siblings.
    const ocoGroups = new Set(
      out.orders.filter((o) => o.row.oco_group_id && o.filledQty.gt(0)).map((o) => String(o.row.oco_group_id)),
    );
    for (const g of ocoGroups)
      await this.cancelOcoSiblings(
        g,
        out.orders.map((o) => o.row.id),
        market,
      );

    for (const p of out.positionsChanged) {
      this.core.bus.emit('position.changed', p);
      if (!sys(p.userId)) void this.publishPosition(p.userId, market);
    }
    if (market.type === 'FUTURES' && out.positionsChanged.length) {
      await this.sweepReduceOnly(
        market,
        out.positionsChanged.map((p) => p.userId),
      );
    }
  }

  private publishOrders(states: OrderState[]): void {
    for (const o of states) {
      const userId = String(o.row.user_id);
      if (this.core.users.isSystemUserCached(userId)) continue;
      const dto: OrderDto = this.core.orders.toDto(rowOf(o));
      this.core.bus.ws(userChannel(userId, 'orders'), 'order', dto);
      if (o.becameFinal && o.status === 'FILLED') {
        void this.core.notifications
          .notify({
            userId,
            type:
              o.row.trigger_state === 'TRIGGERED'
                ? o.row.type.startsWith('TAKE_PROFIT')
                  ? 'TAKE_PROFIT_TRIGGERED'
                  : 'STOP_TRIGGERED'
                : 'ORDER_FILLED',
            title: `${dto.side === 'BUY' ? 'Buy' : 'Sell'} order filled`,
            body: `${dto.symbol}: ${dto.filledQuantity} filled at avg ${dto.avgPrice ?? '-'}`,
            data: { orderId: dto.id, symbol: dto.symbol },
          })
          .catch(() => undefined);
      }
    }
  }

  private async publishPosition(userId: string, market: MarketInfo): Promise<void> {
    try {
      if (market.type === 'FUTURES') {
        const positions = await this.core.futures.positionDtos(userId);
        const p = positions.find((x) => x.symbol === market.symbol) ?? null;
        this.core.bus.ws(userChannel(userId, 'positions'), 'position', {
          marketType: 'FUTURES',
          symbol: market.symbol,
          futures: p,
        });
      } else if (market.type === 'OPTIONS') {
        const positions = await this.core.options.positionDtos(userId);
        const p = positions.find((x) => x.symbol === market.symbol) ?? null;
        this.core.bus.ws(userChannel(userId, 'positions'), 'position', {
          marketType: 'OPTIONS',
          symbol: market.symbol,
          options: p,
        });
      }
    } catch (e) {
      this.core.log.warn({ err: e, userId }, 'position publish failed');
    }
  }

  /** Cancel resting reduce-only orders that no longer reduce the (changed) position. */
  private async sweepReduceOnly(market: MarketInfo, userIds: string[]): Promise<void> {
    const book = this.books.get(market.id);
    if (!book) return;
    for (const userId of new Set(userIds)) {
      const ro = book.ordersOf(userId).filter((o) => o.reduceOnly);
      if (!ro.length) continue;
      const pos = await this.core.db.one<{ side: 'LONG' | 'SHORT' | null; quantity: string }>(
        'SELECT side, quantity FROM futures_positions WHERE user_id = ? AND market_id = ?',
        [userId, market.id],
      );
      const qty = pos?.side ? D(pos.quantity) : ZERO;
      const closingSide: Side | null = pos?.side === 'LONG' ? 'SELL' : pos?.side === 'SHORT' ? 'BUY' : null;
      let budget = qty;
      const victims: string[] = [];
      for (const o of ro.sort((a, b) => a.seq - b.seq)) {
        if (o.side !== closingSide || budget.lte(0)) victims.push(o.id);
        else if (o.remaining.gt(budget)) victims.push(o.id);
        else budget = budget.minus(o.remaining);
      }
      if (victims.length) {
        for (const id of victims) book.cancel(id);
        const changed = await this.settlement.cancelOrders(victims, 'REDUCE_ONLY');
        this.publishOrders(changed);
        this.dirty.add(market.id);
      }
    }
  }

  // ───────────────────────── OCO ─────────────────────────

  /** Stop leg triggered: cancel the resting limit leg and move its reservation to the stop leg. */
  private async activateOcoStopLeg(row: OrderRow, book: OrderBook, market: MarketInfo): Promise<OrderRow | null> {
    const siblings = await this.core.db.query<OrderRow>(
      "SELECT * FROM orders WHERE oco_group_id = ? AND id <> ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
      [row.oco_group_id, row.id],
    );
    if (!siblings.length) return null;
    for (const s of siblings) book.cancel(String(s.id));
    const changed = await this.core.db.transaction(async (tx) => {
      const locked = await this.core.orders.lockMany(tx, [String(row.id), ...siblings.map((s) => String(s.id))]);
      const stop = locked.get(String(row.id));
      if (!stop || stop.status !== 'NEW') return [];
      let moved = ZERO;
      const out: OrderState[] = [];
      for (const s of siblings) {
        const r = locked.get(String(s.id));
        if (!r || !OPEN.includes(r.status)) continue;
        const st = orderState(r);
        moved = moved.plus(st.locked);
        st.locked = ZERO;
        st.status = 'CANCELLED';
        st.rejectReason = 'OCO';
        st.becameFinal = true;
        st.changed = true;
        await this.settlement.saveOrder(tx, st);
        out.push(st);
      }
      await tx.execute('UPDATE orders SET locked_amount = locked_amount + ? WHERE id = ?', [toDb(moved), row.id]);
      await this.core.orders.addHistory(
        tx,
        out.map((o) => ({
          orderId: o.row.id,
          userId: String(o.row.user_id),
          event: 'CANCELLED',
          status: 'CANCELLED' as const,
          details: { reason: 'OCO' },
        })),
      );
      return out;
    });
    this.publishOrders(changed);
    this.dirty.add(market.id);
    return this.core.orders.find(String(row.id));
  }

  private async cancelOcoSiblings(groupId: string, excludeIds: string[], market: MarketInfo): Promise<void> {
    const rows = await this.core.db.query<{ id: string; trigger_state: string }>(
      "SELECT id, trigger_state FROM orders WHERE oco_group_id = ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
      [groupId],
    );
    const ids = rows.map((r) => String(r.id)).filter((id) => !excludeIds.includes(id));
    if (!ids.length) return;
    const book = this.books.get(market.id);
    for (const id of ids) book?.cancel(id);
    const changed = await this.settlement.cancelOrders(ids, 'OCO');
    this.publishOrders(changed);
    for (const r of rows) {
      if (r.trigger_state === 'PENDING')
        this.core.bus.emit('order.trigger', { action: 'removed', orderId: String(r.id), marketId: market.id });
    }
    await this.core.db.execute("UPDATE order_lists SET status = 'ALL_DONE' WHERE id = ?", [groupId]);
  }

  // ───────────────────────── CANCEL ─────────────────────────

  private async handleCancel(orderId: string, userId: string | undefined, reason: string): Promise<EngineResult> {
    const row = await this.core.orders.find(orderId);
    if (!row || (userId && String(row.user_id) !== userId)) return fail('ORDER_NOT_FOUND', 'Order not found', orderId);
    if (!OPEN.includes(row.status)) {
      return row.status === 'CANCELLED'
        ? { ok: true, orderId, status: row.status }
        : fail('ORDER_NOT_CANCELLABLE', `Order is already ${row.status.toLowerCase()}`, orderId);
    }
    const market = this.core.markets.requireId(Number(row.market_id));
    const book = await this.getBook(market);
    const ids = [orderId];
    if (row.oco_group_id) {
      const sib = await this.core.db.query<{ id: string }>(
        "SELECT id FROM orders WHERE oco_group_id = ? AND id <> ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
        [row.oco_group_id, orderId],
      );
      ids.push(...sib.map((s) => String(s.id)));
    }
    for (const id of ids) book.cancel(id);
    try {
      const changed = await this.settlement.cancelOrders(ids, reason);
      this.publishOrders(changed);
      for (const c of changed) {
        if (c.row.trigger_state === 'PENDING')
          this.core.bus.emit('order.trigger', { action: 'removed', orderId: c.row.id, marketId: market.id });
      }
      this.dirty.add(market.id);
      const self = changed.find((c) => c.row.id === orderId);
      return { ok: true, orderId, status: self?.status ?? 'CANCELLED', cancelled: changed.map((c) => c.row.id) };
    } catch (e) {
      await this.loadBook(market);
      throw e;
    }
  }

  private async handleCancelAll(marketId: number, userId: string, reason: string): Promise<EngineResult> {
    const market = this.core.markets.requireId(marketId);
    const book = await this.getBook(market);
    const rows = await this.core.db.query<{ id: string; trigger_state: string }>(
      `SELECT id, trigger_state FROM orders WHERE market_id = ? ${userId === '*' ? '' : 'AND user_id = ?'}
         AND status IN ('NEW','OPEN','PARTIALLY_FILLED')`,
      userId === '*' ? [marketId] : [marketId, userId],
    );
    const ids = rows.map((r) => String(r.id));
    for (const id of ids) book.cancel(id);
    const changed: OrderState[] = [];
    // Chunk to keep transactions short.
    for (let i = 0; i < ids.length; i += 200) {
      changed.push(...(await this.settlement.cancelOrders(ids.slice(i, i + 200), reason)));
    }
    this.publishOrders(changed);
    for (const r of rows) {
      if (r.trigger_state === 'PENDING')
        this.core.bus.emit('order.trigger', { action: 'removed', orderId: String(r.id), marketId });
    }
    this.dirty.add(marketId);
    return { ok: true, cancelled: changed.map((c) => c.row.id) };
  }

  // ───────────────────────── AMEND ─────────────────────────

  private async handleAmend(cmd: Extract<EngineCommand, { kind: 'AMEND' }>): Promise<EngineResult> {
    const row = await this.core.orders.find(cmd.orderId);
    if (!row || String(row.user_id) !== cmd.userId) return fail('ORDER_NOT_FOUND', 'Order not found', cmd.orderId);
    if (row.type !== 'LIMIT' || !(row.status === 'OPEN' || row.status === 'PARTIALLY_FILLED')) {
      return fail('ORDER_NOT_AMENDABLE', 'Only open limit orders can be amended', cmd.orderId);
    }
    const market = this.core.markets.requireId(Number(row.market_id));
    const book = await this.getBook(market);
    const resting = book.get(String(row.id));
    if (!resting) return fail('ORDER_NOT_AMENDABLE', 'Order is not resting in the book', cmd.orderId);

    const oldPrice = D(row.price!);
    const newPrice = cmd.price ? D(cmd.price) : oldPrice;
    const newQty = cmd.quantity ? D(cmd.quantity) : D(row.quantity!);
    const filled = D(row.filled_quantity);
    const newRemaining = newQty.minus(filled);
    if (newRemaining.lte(0))
      return fail('ORDER_NOT_AMENDABLE', 'New quantity must exceed the filled quantity', cmd.orderId);
    const violation = validateLimitOrder(newPrice, newRemaining, market);
    if (violation) return fail('FILTER_VIOLATION', violation, cmd.orderId);
    if (row.post_only && book.wouldCross(row.side, newPrice) && !newPrice.eq(oldPrice)) {
      return fail('POST_ONLY_REJECTED', 'Amended price would take liquidity', cmd.orderId);
    }

    const keepsPriority = newPrice.eq(oldPrice) && newRemaining.lte(resting.remaining);
    // Recompute the reservation for the new remaining quantity / price.
    const flags = await this.core.users.flags(cmd.userId);
    const rates = await this.core.fees.ratesFor(
      { id: cmd.userId, vipTier: flags.vipTier, isSystem: flags.isSystem },
      market,
    );
    let required: Decimal;
    if (market.type === 'SPOT') required = spotReserve(row.side, newRemaining, newPrice);
    else if (market.type === 'FUTURES') {
      required = futuresReserve({
        market,
        side: row.side,
        qty: newRemaining,
        price: newPrice,
        leverage: row.leverage ?? 20,
        takerRate: rates.taker,
        reduceOnly: Boolean(row.reduce_only),
      });
    } else {
      const idx = (await this.core.options.indexFor(market.option!.underlying)) ?? Number(market.option!.strike);
      const { mark } = this.core.options.markFor(
        market,
        idx,
        await this.core.options.baseIv(market.option!.underlying),
      );
      required = optionsReserve({
        market,
        side: row.side,
        qty: newRemaining,
        price: newPrice,
        indexPrice: idx,
        markPrice: mark,
        feeRate: rates.taker,
      });
    }

    let out: SettleOutput;
    try {
      const updated = await this.core.db.transaction(async (tx) => {
        const locked = await this.core.orders.lock(tx, String(row.id));
        if (!locked || !(locked.status === 'OPEN' || locked.status === 'PARTIALLY_FILLED')) {
          throw new AppError('ORDER_NOT_AMENDABLE', 'Order changed while amending');
        }
        const current = D(locked.locked_amount);
        const diff = q18(required).minus(current);
        const sim = new BalanceSim(new Map());
        const account = market.type;
        const meta = {
          type: (diff.gt(0) ? 'ORDER_LOCK' : 'ORDER_UNLOCK') as 'ORDER_LOCK' | 'ORDER_UNLOCK',
          refType: 'ORDER',
          refId: String(row.id),
        };
        if (diff.gt(0)) sim.reserve(cmd.userId, Number(locked.lock_asset_id), account, diff, meta);
        else if (diff.lt(0)) sim.release(cmd.userId, Number(locked.lock_asset_id), account, diff.neg(), meta);
        if (sim.changes.length) await this.core.wallet.apply(tx, sim.changes);
        await tx.execute('UPDATE orders SET price = ?, quantity = ?, locked_amount = ? WHERE id = ?', [
          toDb(newPrice),
          toDb(newQty),
          toDb(q18(required)),
          row.id,
        ]);
        await this.core.orders.addHistory(tx, [
          {
            orderId: String(row.id),
            userId: cmd.userId,
            event: 'AMENDED',
            status: locked.status,
            details: {
              from: { price: locked.price, quantity: locked.quantity },
              to: { price: newPrice.toFixed(), quantity: newQty.toFixed() },
            },
          },
        ]);
        return (await this.core.orders.find(String(row.id), tx))!;
      });

      if (keepsPriority) {
        book.reduce(String(row.id), newRemaining);
        this.dirty.add(market.id);
        this.core.bus.ws(userChannel(cmd.userId, 'orders'), 'order', this.core.orders.toDto(updated));
        return { ok: true, orderId: cmd.orderId, status: updated.status };
      }
      // Price change / size increase: lose priority and re-enter as an incoming order.
      book.cancel(String(row.id));
      const result = book.match({
        id: String(row.id),
        userId: cmd.userId,
        side: row.side,
        kind: 'LIMIT',
        price: newPrice,
        quantity: newRemaining,
        maxQuote: market.type === 'SPOT' && row.side === 'BUY' ? q18(required) : undefined,
        timeInForce: row.post_only ? 'GTX' : 'GTC',
        stp: 'EXPIRE_MAKER',
        reduceOnly: Boolean(row.reduce_only),
      });
      out = await this.settlement.settleMatch({
        market,
        takerId: String(row.id),
        takerQty: newQty,
        result,
        takerOpen: true,
      });
    } catch (e) {
      await this.loadBook(market);
      if (e instanceof AppError) return fail(e.code, e.message, cmd.orderId);
      throw e;
    }
    await this.afterSettleSafe(market, out);
    return { ok: true, orderId: cmd.orderId, status: out.orders.find((o) => o.row.id === String(row.id))?.status };
  }

  // ───────────────────────── background ─────────────────────────

  /** Re-submit orders that were accepted (funds locked) but never reached the engine. */
  async sweepOrphans(minAgeMs: number): Promise<number> {
    const owned = this.opts.owns
      ? this.core.markets
          .list()
          .filter((m) => this.owns(m.id))
          .map((m) => m.id)
      : null;
    if (owned && owned.length === 0) return 0;
    const rows = await this.core.db.query<{ id: string; market_id: number }>(
      `SELECT id, market_id FROM orders
        WHERE status = 'NEW' AND trigger_state IN ('NONE','TRIGGERED') AND created_at < (NOW(3) - INTERVAL ? MICROSECOND)
          ${owned ? `AND market_id IN (${owned.map(() => '?').join(', ')})` : ''}
        ORDER BY id LIMIT 1000`,
      [minAgeMs * 1000, ...(owned ?? [])],
    );
    for (const r of rows) void this.submit({ kind: 'NEW', orderId: String(r.id), marketId: Number(r.market_id) });
    if (rows.length) this.core.log.info({ count: rows.length }, 're-submitted unprocessed orders');
    return rows.length;
  }

  /** One publish tick: coalesced public trades, then depth for the books that changed since the last tick. */
  publishDepth(): Promise<void> {
    for (const { symbol, trades } of this.pendingTrades.values()) {
      this.core.bus.ws(marketChannel(symbol, 'trades'), 'trades', trades);
    }
    this.pendingTrades.clear();
    if (!this.dirty.size) return Promise.resolve();
    const levels = this.opts.depthLevels ?? 100;
    const pipe = this.core.redis.pub.pipeline();
    for (const id of this.dirty) {
      const book = this.books.get(id);
      const market = this.core.markets.byId(id);
      if (!book || !market) continue;
      const depth = book.depth(levels);
      const snapshot = {
        symbol: market.symbol,
        bids: depth.bids,
        asks: depth.asks,
        seq: book.tradeSeq * 1_000_000 + book.orderSeq,
        ts: Date.now(),
      };
      pipe.set(PriceService.bookKey(market.symbol), JSON.stringify(snapshot));
      this.core.bus.ws(marketChannel(market.symbol, 'orderbook'), 'orderbook', snapshot);
      metrics.bookDepth.set({ symbol: market.symbol }, book.size);
      metrics.engineQueueDepth.set({ symbol: market.symbol }, this.pending.get(id) ?? 0);
    }
    this.dirty.clear();
    return pipe
      .exec()
      .then(() => undefined)
      .catch((e) => this.core.log.warn({ err: e }, 'depth publish failed'));
  }
}
