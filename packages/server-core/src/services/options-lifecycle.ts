import { D, type Decimal, ZERO, formatOptionSymbol, optionPayoff, toDb, toPlain } from '@gocrypto/trading-utils';
import type { Core } from '../core';
import type { EngineGateway } from '../engine-protocol';
import { isDuplicateKeyError } from '../errors';
import type { BalanceChange } from './wallet';

const EXPIRY_HOUR = 8;

/** 1/2/5 x 10^n rounding used for strike spacing and premium ticks. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exp;
  const nice = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10;
  return nice * 10 ** exp;
}

function lastFridayOfMonth(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month + 1, 0, EXPIRY_HOUR));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

/** Listing schedule: 2 dailies, 2 weekly Fridays and the next two monthly expiries. */
export function optionExpiries(now = Date.now()): number[] {
  const out = new Set<number>();
  const minLead = 6 * 3_600_000;
  const today = new Date(now);
  for (let i = 0; out.size < 2 && i < 10; i++) {
    const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i, EXPIRY_HOUR);
    if (t - now > minLead) out.add(t);
  }
  let fridays = 0;
  for (let i = 0; fridays < 2 && i < 30; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i, EXPIRY_HOUR));
    if (d.getUTCDay() === 5 && d.getTime() - now > minLead) {
      out.add(d.getTime());
      fridays += 1;
    }
  }
  for (let m = 0, added = 0; added < 2 && m < 4; m++) {
    const t = lastFridayOfMonth(today.getUTCFullYear(), today.getUTCMonth() + m);
    if (t - now > minLead) {
      out.add(t);
      added += 1;
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Option contract listing and cash settlement at expiry. */
export class OptionsLifecycleService {
  constructor(
    private readonly core: Core,
    private readonly engine: EngineGateway | null,
  ) {}

  /** Create missing contracts around the current index price. Returns how many were listed. */
  async listContracts(underlying: string, now = Date.now(), strikesEachSide = 8): Promise<number> {
    const index = await this.core.prices.indexPrice(underlying);
    if (!index) return 0;
    const spot = Number(index);
    const asset = this.core.assets.require(underlying);
    const usdt = this.core.assets.require('USDT');
    const strikeStep = niceStep(spot * 0.025);
    const tick = niceStep(spot * 0.00002);
    const atm = Math.round(spot / strikeStep) * strikeStep;
    let created = 0;
    for (const expiry of optionExpiries(now)) {
      const days = (expiry - now) / 86_400_000;
      const width = Math.max(3, Math.round(strikesEachSide * Math.min(1.5, Math.sqrt(Math.max(days, 1) / 7))));
      for (let k = -width; k <= width; k++) {
        const strike = atm + k * strikeStep;
        if (strike <= 0) continue;
        for (const type of ['CALL', 'PUT'] as const) {
          const strikeStr = D(strike).toFixed();
          const symbol = formatOptionSymbol(underlying, expiry, strikeStr, type);
          if (this.core.markets.bySymbol(symbol)) continue;
          try {
            await this.core.db.transaction(async (tx) => {
              const res = await tx.execute(
                `INSERT INTO markets (symbol, type, display_name, base_asset_id, quote_asset_id, tick_size, step_size, min_qty, max_qty, min_notional, price_band, sort_order)
                 VALUES (?, 'OPTIONS', ?, ?, ?, ?, '0.01', '0.01', '10000', 0, 0.2, 1000)`,
                [symbol, `${underlying} ${new Date(expiry).toISOString().slice(0, 10)} ${strikeStr} ${type === 'CALL' ? 'Call' : 'Put'}`, asset.id, usdt.id, D(tick).toFixed()],
              );
              await tx.execute(
                `INSERT INTO options_contracts (market_id, underlying_asset_id, quote_asset_id, option_type, strike, expiry_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [res.insertId, asset.id, usdt.id, type, strikeStr, new Date(expiry)],
              );
            });
            created += 1;
          } catch (e) {
            if (!isDuplicateKeyError(e)) throw e;
          }
        }
      }
    }
    if (created) {
      await this.core.markets.load();
      this.core.configChanged('markets');
      this.core.log.info({ underlying, created }, 'option contracts listed');
    }
    return created;
  }

  /** Settle every contract whose expiry has passed. */
  async settleExpired(now = Date.now()): Promise<number> {
    const due = this.core.markets.list('OPTIONS').filter((m) => m.option && m.option.expiryAt <= now && m.option.status === 'ACTIVE');
    let settled = 0;
    for (const m of due) {
      const index = await this.core.prices.indexPrice(m.option!.underlying);
      if (!index) continue;
      await this.settleContract(m.id, D(index));
      settled += 1;
    }
    if (settled) {
      await this.core.markets.load();
      this.core.configChanged('markets');
    }
    return settled;
  }

  /** Cash-settle one contract at `settlementPrice`. Exactly once per (contract, user). */
  async settleContract(marketId: number, settlementPrice: Decimal): Promise<number> {
    const market = this.core.markets.requireId(marketId);
    const opt = market.option!;
    // 1. stop trading and pull resting orders
    await this.core.db.execute("UPDATE markets SET status = 'SETTLED' WHERE id = ?", [marketId]);
    await this.core.db.execute("UPDATE options_contracts SET status = 'EXPIRED' WHERE market_id = ? AND status = 'ACTIVE'", [marketId]);
    if (this.engine) await this.engine.submit({ kind: 'CANCEL_ALL', marketId, userId: '*', reason: 'EXPIRY' });

    const payoff = optionPayoff(opt.optionType, settlementPrice, opt.strike);
    const holders = await this.core.db.query<{ user_id: string }>(
      "SELECT DISTINCT user_id FROM options_positions WHERE market_id = ? AND status = 'OPEN' AND quantity > 0",
      [marketId],
    );
    const settle = market.quoteAssetId;
    const ins = this.core.users.systemIds.insuranceFund;
    const userIds = holders.map((h) => String(h.user_id));
    let count = 0;
    if (userIds.length) {
      await this.core.wallet.ensureWallets(this.core.db, [...userIds, ins].map((userId) => ({ userId, assetId: settle, account: 'OPTIONS' as const })));
      count = await this.core.db.transaction(async (tx) => {
        const wallets = await this.core.wallet.lockWallets(tx, [...userIds, ins].map((userId) => ({ userId, assetId: settle, account: 'OPTIONS' as const })));
        const positions = await this.core.options.lockPositions(tx, userIds.map((userId) => ({ userId, marketId })));
        const changes: BalanceChange[] = [];
        let insuranceCover = ZERO;
        let n = 0;
        for (const pos of positions.values()) {
          if (!pos.side || pos.qty.isZero()) continue;
          const amount = payoff.mul(pos.qty);
          const meta = { type: 'OPTION_SETTLEMENT' as const, refType: 'OPTION_EXPIRY', refId: market.symbol };
          const payout = pos.side === 'LONG' ? amount : amount.neg();
          if (pos.side === 'LONG') {
            if (amount.gt(0)) changes.push({ userId: pos.userId, assetId: settle, account: 'OPTIONS', available: amount, ...meta, idemKey: `optset:${marketId}:${pos.userId}` });
          } else {
            const w = wallets.get(`${pos.userId}:OPTIONS:${settle}`)!;
            const free = w.available.plus(pos.margin);
            const shortfall = amount.gt(free) ? amount.minus(free) : ZERO;
            if (pos.margin.gt(0)) {
              changes.push({ userId: pos.userId, assetId: settle, account: 'OPTIONS', available: pos.margin, locked: pos.margin.neg(), type: 'MARGIN_UNLOCK', refType: 'OPTION_EXPIRY', refId: market.symbol });
            }
            if (amount.gt(0)) changes.push({ userId: pos.userId, assetId: settle, account: 'OPTIONS', available: amount.neg(), ...meta, idemKey: `optset:${marketId}:${pos.userId}` });
            if (shortfall.gt(0)) {
              changes.push({ userId: pos.userId, assetId: settle, account: 'OPTIONS', available: shortfall, type: 'INSURANCE_FUND', refType: 'OPTION_EXPIRY', refId: market.symbol });
              insuranceCover = insuranceCover.plus(shortfall);
            }
          }
          try {
            await tx.execute(
              `INSERT INTO options_settlements (user_id, position_id, market_id, side, quantity, strike, settlement_price, payout, margin_released)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [pos.userId, pos.id, marketId, pos.side, toDb(pos.qty), toDb(opt.strike), toDb(settlementPrice), toDb(payout), toDb(pos.margin)],
            );
          } catch (e) {
            if (isDuplicateKeyError(e, 'uq_option_settlement')) continue;
            throw e;
          }
          pos.realizedPnl = pos.realizedPnl.plus(payout);
          pos.qty = ZERO;
          pos.margin = ZERO;
          pos.side = null;
          pos.status = 'SETTLED';
          pos.dirty = true;
          n += 1;
        }
        if (insuranceCover.gt(0)) {
          changes.push({ userId: ins, assetId: settle, account: 'OPTIONS', available: insuranceCover.neg(), type: 'INSURANCE_FUND', refType: 'OPTION_EXPIRY', refId: market.symbol });
        }
        await this.core.wallet.apply(tx, changes, wallets);
        await this.core.options.savePositions(tx, positions.values());
        return n;
      });
    }
    await this.core.db.execute(
      "UPDATE options_contracts SET status = 'SETTLED', settlement_price = ?, settled_at = CURRENT_TIMESTAMP(3) WHERE market_id = ?",
      [toDb(settlementPrice), marketId],
    );
    for (const userId of userIds) {
      if (this.core.users.isSystemUserCached(userId)) continue;
      await this.core.notifications.notify({
        userId,
        type: 'OPTION_SETTLED',
        title: `${market.symbol} settled`,
        body: `Settled at ${toPlain(settlementPrice)}. Payoff per contract: ${toPlain(payoff)} USDT.`,
        data: { symbol: market.symbol },
      });
      this.core.bus.emit('position.changed', { userId, marketId, marketType: 'OPTIONS' });
    }
    this.core.log.info({ symbol: market.symbol, settlementPrice: settlementPrice.toFixed(), positions: count }, 'option contract settled');
    return count;
  }
}
