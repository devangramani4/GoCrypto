import type { LiquidationDto, MarginMode, PositionSide } from '@gocrypto/shared-types';
import { marketChannel, userChannel } from '@gocrypto/shared-types';
import {
  type Core,
  type EngineGateway,
  type PositionState,
  applyFuturesFill,
  evaluateAccount,
  isDuplicateKeyError,
  key,
  liquidationCheck,
  metrics,
  positionKey,
} from '@gocrypto/server-core';
import { BalanceSim } from '@gocrypto/matching-engine';
import { D, type Decimal, ZERO, dmax, dmin, maintenanceMargin, toDb, toPlain } from '@gocrypto/trading-utils';

interface AccountCache {
  wallet: { available: Decimal; locked: Decimal };
  positions: PositionState[];
}

export interface LiquidationRecord {
  id: string;
  userId: string;
  positionId: string;
  positionVersion: number;
  marketId: number;
  symbol: string;
  side: PositionSide;
  quantity: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal;
  marginMode: MarginMode;
  margin: Decimal;
  realizedPnl: Decimal;
  fee: Decimal;
  insuranceDelta: Decimal;
}

const INSURANCE_LEVERAGE = 10;

/**
 * Event-driven liquidation engine.
 *
 * Keeps every account with open futures positions in memory and re-evaluates the affected accounts
 * on each mark-price tick (no per-user timers). Execution is protected against double liquidation
 * by four independent layers: an in-process in-flight set, a Redis lock per user, a re-check under
 * row locks inside the DB transaction, and a UNIQUE (position_id, position_version) constraint.
 */
export class LiquidationEngine {
  private readonly accounts = new Map<string, AccountCache>();
  private readonly usersByMarket = new Map<number, Set<string>>();
  private readonly marks = new Map<number, Decimal>();
  private readonly inFlight = new Set<string>();
  private readonly reloadPending = new Set<string>();
  private reloadTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly core: Core,
    private readonly engine: EngineGateway,
  ) {}

  async start(): Promise<void> {
    for (const m of this.core.markets.list('FUTURES')) {
      const mp = await this.core.prices.markPrice(m.symbol);
      if (mp) this.marks.set(m.id, D(mp.markPrice));
    }
    for (const userId of await this.core.futures.usersWithPositions()) await this.reload(userId);
    this.core.events.on('price.mark', (p) => {
      this.marks.set(p.marketId, D(p.markPrice));
      this.onMark(p.marketId);
    });
    this.core.events.on('position.changed', ({ userId, marketType }) => {
      if (marketType === 'FUTURES') this.scheduleReload(userId);
    });
    this.core.events.on('account.changed', ({ userId, account }) => {
      if (account === 'FUTURES') this.scheduleReload(userId);
    });
    await this.core.events.start();
    this.sweepTimer = setInterval(() => this.evaluateAll(), 3000);
    this.sweepTimer.unref();
    this.core.log.info({ accounts: this.accounts.size }, 'liquidation engine started');
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
  }

  get trackedAccounts(): number {
    return this.accounts.size;
  }

  setMark(marketId: number, price: Decimal): void {
    this.marks.set(marketId, price);
  }

  private scheduleReload(userId: string): void {
    this.reloadPending.add(userId);
    if (this.reloadTimer) return;
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      const users = [...this.reloadPending];
      this.reloadPending.clear();
      for (const u of users) void this.reload(u).catch((e) => this.core.log.warn({ err: e, userId: u }, 'account reload failed'));
    }, 50);
  }

  async reload(userId: string): Promise<void> {
    const usdt = this.core.assets.require('USDT');
    const [wallet, positions] = await Promise.all([
      this.core.wallet.getWallet(this.core.db, { userId, assetId: usdt.id, account: 'FUTURES' }),
      this.core.futures.positionsOf(userId),
    ]);
    for (const set of this.usersByMarket.values()) set.delete(userId);
    if (!positions.length) {
      this.accounts.delete(userId);
      return;
    }
    this.accounts.set(userId, { wallet: { available: wallet?.available ?? ZERO, locked: wallet?.locked ?? ZERO }, positions });
    for (const p of positions) {
      const set = this.usersByMarket.get(p.marketId) ?? new Set<string>();
      set.add(userId);
      this.usersByMarket.set(p.marketId, set);
    }
    this.evaluate(userId);
  }

  private onMark(marketId: number): void {
    for (const u of this.usersByMarket.get(marketId) ?? []) this.evaluate(u);
  }

  private evaluateAll(): void {
    for (const u of this.accounts.keys()) this.evaluate(u);
  }

  /** Evaluate one account from cached state; kicks off execution when needed. */
  evaluate(userId: string): void {
    const acct = this.accounts.get(userId);
    if (!acct || this.inFlight.has(userId) || this.core.users.isSystemUserCached(userId)) return;
    metrics.liquidationChecks.inc();
    const items = acct.positions.map((pos) => ({
      pos,
      market: this.core.markets.requireId(pos.marketId),
      mark: this.marks.get(pos.marketId) ?? pos.entry,
    }));
    const account = evaluateAccount(acct.wallet, items, ZERO);
    const verdicts = liquidationCheck(acct.positions, account);
    if (verdicts.length) {
      void this.execute(userId).catch((e) => this.core.log.error({ err: e, userId }, 'liquidation failed'));
      return;
    }
    // Early warning when an account approaches its maintenance requirement.
    const warnRatio = D(this.core.settings.get('risk.liquidation_warning_ratio'));
    const crossBalance = account.walletBalance.minus(account.isolatedMargin).plus(account.crossUnrealizedPnl);
    let ratio = crossBalance.gt(0) && account.crossMaintenance.gt(0) ? account.crossMaintenance.div(crossBalance) : ZERO;
    for (const { pos } of items) {
      if (pos.marginMode !== 'ISOLATED') continue;
      const m = account.perPosition.get(pos.id);
      const bal = m ? pos.margin.plus(m.unrealizedPnl) : ZERO;
      if (m && bal.gt(0)) ratio = dmax(ratio, m.maintenanceMargin.div(bal));
    }
    if (ratio.gte(warnRatio)) void this.warn(userId, ratio);
  }

  private async warn(userId: string, ratio: Decimal): Promise<void> {
    const ok = await this.core.redis.main.set(key('liqwarn', userId), '1', 'EX', 1800, 'NX');
    if (ok !== 'OK') return;
    await this.core.notifications.notify({
      userId,
      type: 'LIQUIDATION_WARNING',
      title: 'Liquidation warning',
      body: `Your futures margin ratio reached ${ratio.mul(100).toFixed(1)}%. Add margin or reduce positions to avoid liquidation.`,
      data: { marginRatio: ratio.toFixed(4) },
    });
  }

  /**
   * Liquidate every position that currently fails the maintenance test. Returns the records written.
   */
  async execute(userId: string): Promise<LiquidationRecord[]> {
    if (this.inFlight.has(userId)) return [];
    this.inFlight.add(userId);
    try {
      const result = await this.core.lock.withLock(`liq:${userId}`, 30_000, async () => {
        const positions = await this.core.futures.positionsOf(userId);
        const marketIds = [...new Set(positions.map((p) => p.marketId))];
        const orderMarkets = await this.core.db.query<{ market_id: number }>(
          "SELECT DISTINCT market_id FROM orders WHERE user_id = ? AND market_type = 'FUTURES' AND status IN ('NEW','OPEN','PARTIALLY_FILLED')",
          [userId],
        );
        // Cancel open orders first: releases reserved margin and stops new fills on stale orders.
        for (const mid of new Set([...marketIds, ...orderMarkets.map((r) => Number(r.market_id))])) {
          await this.engine.submit({ kind: 'CANCEL_ALL', marketId: mid, userId, reason: 'LIQUIDATION' });
        }
        return this.liquidate(userId);
      });
      return result ?? [];
    } finally {
      this.inFlight.delete(userId);
      await this.reload(userId).catch(() => undefined);
    }
  }

  /** The atomic part: re-check under row locks, close positions, settle, record. */
  async liquidate(userId: string): Promise<LiquidationRecord[]> {
    const ins = this.core.users.systemIds.insuranceFund;
    const usdt = this.core.assets.require('USDT');
    const marks = new Map(this.marks);
    for (const m of this.core.markets.list('FUTURES')) {
      if (!marks.has(m.id)) {
        const mp = await this.core.prices.markPrice(m.symbol);
        if (mp) marks.set(m.id, D(mp.markPrice));
      }
    }
    await this.core.wallet.ensureWallets(this.core.db, [
      { userId, assetId: usdt.id, account: 'FUTURES' },
      { userId: ins, assetId: usdt.id, account: 'FUTURES' },
    ]);
    const openIds = await this.core.db.query<{ market_id: number }>(
      "SELECT market_id FROM futures_positions WHERE user_id = ? AND status = 'OPEN' AND quantity > 0",
      [userId],
    );
    if (!openIds.length) return [];

    const records = await this.core.db.transaction(async (tx) => {
      const wallets = await this.core.wallet.lockWallets(tx, [
        { userId, assetId: usdt.id, account: 'FUTURES' },
        { userId: ins, assetId: usdt.id, account: 'FUTURES' },
      ]);
      const keys = openIds.flatMap((r) => [
        { userId, marketId: Number(r.market_id) },
        { userId: ins, marketId: Number(r.market_id), leverage: INSURANCE_LEVERAGE, marginMode: 'CROSS' as const },
      ]);
      const positions = await this.core.futures.lockPositions(tx, keys);
      const userPositions = [...positions.values()].filter((p) => p.userId === userId && p.side && p.qty.gt(0));
      const wallet = wallets.get(`${userId}:FUTURES:${usdt.id}`)!;
      const items = userPositions.map((pos) => ({
        pos,
        market: this.core.markets.requireId(pos.marketId),
        mark: marks.get(pos.marketId) ?? pos.entry,
      }));
      const account = evaluateAccount({ available: wallet.available, locked: wallet.locked }, items, ZERO);
      const verdicts = liquidationCheck(userPositions, account);
      if (!verdicts.length) return [];

      const sim = new BalanceSim(wallets);
      const out: LiquidationRecord[] = [];
      for (const verdict of verdicts) {
        if (!verdict.liquidate) continue;
        let mmTotal = ZERO;
        let scopeRemaining = ZERO;
        const scope: LiquidationRecord[] = [];
        for (const posId of verdict.positionIds) {
          const pos = userPositions.find((p) => p.id === posId);
          if (!pos || !pos.side || pos.qty.isZero()) continue;
          const market = this.core.markets.requireId(pos.marketId);
          const mark = marks.get(pos.marketId) ?? pos.entry;
          const before = { version: pos.version, side: pos.side, qty: pos.qty, entry: pos.entry, margin: pos.margin, mode: pos.marginMode };
          mmTotal = mmTotal.plus(maintenanceMargin(market.futures!.riskTiers, pos.qty, mark));
          const meta = { refType: 'LIQUIDATION', refId: `${pos.id}:${before.version}` };
          const eff = applyFuturesFill(pos, before.side === 'LONG' ? 'SELL' : 'BUY', before.qty, mark, pos.leverage);
          sim.release(userId, usdt.id, 'FUTURES', eff.marginReleased, { type: 'MARGIN_UNLOCK', ...meta });
          if (!eff.realizedPnl.isZero()) sim.add(userId, usdt.id, 'FUTURES', { available: eff.realizedPnl }, { type: 'REALIZED_PNL', ...meta });
          pos.status = 'LIQUIDATED';
          pos.dirty = true;
          if (before.mode === 'ISOLATED') scopeRemaining = scopeRemaining.plus(before.margin.plus(eff.realizedPnl));

          // Insurance fund takes over the position at the mark price.
          const insPos = positions.get(positionKey(ins, pos.marketId))!;
          if (!insPos.side) {
            insPos.leverage = INSURANCE_LEVERAGE;
            insPos.marginMode = 'CROSS';
          }
          const insEff = applyFuturesFill(insPos, before.side === 'LONG' ? 'BUY' : 'SELL', before.qty, mark, INSURANCE_LEVERAGE);
          sim.release(ins, usdt.id, 'FUTURES', insEff.marginReleased, { type: 'MARGIN_UNLOCK', ...meta });
          if (!insEff.realizedPnl.isZero()) sim.add(ins, usdt.id, 'FUTURES', { available: insEff.realizedPnl }, { type: 'REALIZED_PNL', ...meta });
          if (insEff.marginNeeded.gt(0)) {
            const affordable = dmax(ZERO, dmin(insEff.marginNeeded, sim.available(ins, usdt.id, 'FUTURES')));
            sim.reserve(ins, usdt.id, 'FUTURES', affordable, { type: 'MARGIN_LOCK', ...meta });
            insPos.margin = insPos.margin.plus(affordable);
          }
          scope.push({
            id: '',
            userId,
            positionId: pos.id,
            positionVersion: before.version,
            marketId: pos.marketId,
            symbol: market.symbol,
            side: before.side,
            quantity: before.qty,
            entryPrice: before.entry,
            markPrice: mark,
            marginMode: before.mode,
            margin: before.margin,
            realizedPnl: eff.realizedPnl,
            fee: ZERO,
            insuranceDelta: ZERO,
          });
        }
        // Liquidation fee: the equity left in the liquidated scope (capped at maintenance) goes to the insurance fund.
        const remaining = verdict.mode === 'CROSS' ? sim.available(userId, usdt.id, 'FUTURES') : scopeRemaining;
        const fee = dmax(ZERO, dmin(remaining, mmTotal, sim.available(userId, usdt.id, 'FUTURES')));
        if (fee.gt(0)) {
          sim.add(userId, usdt.id, 'FUTURES', { available: fee.neg() }, { type: 'LIQUIDATION', refType: 'LIQUIDATION', refId: scope[0]?.positionId });
          sim.add(ins, usdt.id, 'FUTURES', { available: fee }, { type: 'INSURANCE_FUND', refType: 'LIQUIDATION', refId: scope[0]?.positionId });
        }
        // Bankruptcy: losses beyond the account's equity are absorbed by the insurance fund.
        const avail = sim.available(userId, usdt.id, 'FUTURES');
        let insuranceDelta = fee;
        if (avail.isNegative()) {
          sim.add(userId, usdt.id, 'FUTURES', { available: avail.neg() }, { type: 'INSURANCE_FUND', refType: 'BANKRUPTCY', refId: scope[0]?.positionId });
          sim.add(ins, usdt.id, 'FUTURES', { available: avail }, { type: 'INSURANCE_FUND', refType: 'BANKRUPTCY', refId: scope[0]?.positionId });
          insuranceDelta = insuranceDelta.plus(avail);
        }
        if (scope.length) {
          scope[0]!.fee = fee;
          scope[0]!.insuranceDelta = insuranceDelta;
        }
        out.push(...scope);
      }

      await this.core.wallet.apply(tx, sim.changes, wallets);
      await this.core.futures.savePositions(tx, positions.values());
      for (const r of out) {
        try {
          const res = await tx.execute(
            `INSERT INTO liquidations (user_id, position_id, market_id, position_version, side, quantity, entry_price, mark_price,
               margin_mode, margin, realized_pnl, liquidation_fee, insurance_fund_delta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              r.positionId,
              r.marketId,
              r.positionVersion,
              r.side,
              toDb(r.quantity),
              toDb(r.entryPrice),
              toDb(r.markPrice),
              r.marginMode,
              toDb(r.margin),
              toDb(r.realizedPnl),
              toDb(r.fee),
              toDb(r.insuranceDelta),
            ],
          );
          r.id = res.insertId;
        } catch (e) {
          if (isDuplicateKeyError(e, 'uq_liquidation_version')) {
            throw new Error(`position ${r.positionId} version ${r.positionVersion} already liquidated`, { cause: e });
          }
          throw e;
        }
      }
      await this.core.audit.log(
        { actorType: 'SYSTEM', action: 'futures.liquidation', targetType: 'USER', targetId: userId, metadata: { positions: out.map((r) => r.symbol) } },
        tx,
      );
      return out;
    });

    for (const r of records) {
      metrics.liquidationsTotal.inc({ margin_mode: r.marginMode });
      const dto: LiquidationDto = {
        id: r.id,
        symbol: r.symbol,
        side: r.side,
        quantity: toPlain(r.quantity),
        entryPrice: toPlain(r.entryPrice.toDecimalPlaces(8)),
        markPrice: toPlain(r.markPrice),
        marginMode: r.marginMode,
        loss: toPlain(r.realizedPnl.neg().toDecimalPlaces(8)),
        fee: toPlain(r.fee.toDecimalPlaces(8)),
        createdAt: Date.now(),
      };
      this.core.bus.ws(userChannel(userId, 'liquidations'), 'liquidation', dto);
      this.core.bus.ws(marketChannel(r.symbol, 'liquidations'), 'liquidation', { ...dto, id: '' });
      this.core.bus.ws(userChannel(userId, 'positions'), 'position', { marketType: 'FUTURES', symbol: r.symbol, futures: null });
      this.core.bus.emit('position.changed', { userId, marketId: r.marketId, marketType: 'FUTURES' });
      this.core.bus.emit('position.changed', { userId: ins, marketId: r.marketId, marketType: 'FUTURES' });
      await this.core.notifications.notify({
        userId,
        type: 'LIQUIDATION',
        title: `${r.symbol} position liquidated`,
        body: `Your ${r.side.toLowerCase()} position of ${toPlain(r.quantity)} was liquidated at mark price ${toPlain(r.markPrice)}.`,
        data: { symbol: r.symbol, liquidationId: r.id },
      });
    }
    if (records.length) this.core.log.warn({ userId, count: records.length }, 'positions liquidated');
    return records;
  }
}
