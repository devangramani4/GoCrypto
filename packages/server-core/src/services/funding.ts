import type { FundingRateDto } from '@gocrypto/shared-types';
import { userChannel } from '@gocrypto/shared-types';
import { D, type Decimal, ZERO, dmin, fundingPayment, toDb, toPlain } from '@gocrypto/trading-utils';
import type { MarketInfo } from '../cache/markets';
import type { Core } from '../core';
import { toMsStrict } from '../db/database';
import { isDuplicateKeyError } from '../errors';
import { metrics } from '../metrics';
import { positionKey } from './futures';
import type { BalanceChange } from './wallet';

/** Perpetual funding: schedule, rate history and exactly-once settlement per position. */
export class FundingService {
  constructor(private readonly core: Core) {}

  /** Next funding timestamp aligned to the contract's interval (UTC). */
  static nextFundingTime(intervalHours: number, now = Date.now()): number {
    const interval = intervalHours * 3_600_000;
    return Math.floor(now / interval) * interval + interval;
  }

  async history(market: MarketInfo, limit = 100): Promise<FundingRateDto[]> {
    const rows = await this.core.db.query<Record<string, unknown>>(
      'SELECT * FROM funding_rates WHERE market_id = ? ORDER BY funding_time DESC LIMIT ?',
      [market.id, limit],
    );
    return rows.map((r) => ({
      symbol: market.symbol,
      fundingRate: toPlain(String(r.funding_rate)),
      fundingTime: toMsStrict(r.funding_time),
      markPrice: toPlain(String(r.mark_price)),
      indexPrice: toPlain(String(r.index_price)),
    }));
  }

  /**
   * Settle funding for every open position of a contract at `fundingTime`. Idempotent: the rate row
   * and each payment are unique, and already-settled funding times are skipped.
   */
  async settle(market: MarketInfo, fundingTime: number, rate: Decimal, markPrice: Decimal, indexPrice: Decimal): Promise<number> {
    const at = new Date(fundingTime);
    try {
      await this.core.db.execute('INSERT INTO funding_rates (market_id, funding_time, funding_rate, mark_price, index_price) VALUES (?, ?, ?, ?, ?)', [
        market.id,
        at,
        rate.toFixed(10),
        toDb(markPrice),
        toDb(indexPrice),
      ]);
    } catch (e) {
      if (!isDuplicateKeyError(e, 'uq_funding_rate')) throw e;
      const existing = await this.core.db.one<{ settled_at: Date | null }>('SELECT settled_at FROM funding_rates WHERE market_id = ? AND funding_time = ?', [
        market.id,
        at,
      ]);
      if (existing?.settled_at) return 0;
    }
    const settle = market.quoteAssetId;
    const holders = await this.core.db.query<{ user_id: string }>(
      "SELECT DISTINCT user_id FROM futures_positions WHERE market_id = ? AND status = 'OPEN' AND quantity > 0",
      [market.id],
    );
    let count = 0;
    for (const { user_id } of holders) {
      const userId = String(user_id);
      const paid = await this.core.db.transaction(async (tx) => {
        const wallets = await this.core.wallet.lockWallets(tx, [{ userId, assetId: settle, account: 'FUTURES' }]);
        const positions = await this.core.futures.lockPositions(tx, [{ userId, marketId: market.id }]);
        const pos = positions.get(positionKey(userId, market.id))!;
        if (!pos.side || pos.qty.isZero()) return false;
        const amount = fundingPayment(pos.side, pos.qty, markPrice, rate);
        try {
          await tx.execute(
            `INSERT INTO funding_payments (user_id, position_id, market_id, funding_time, position_side, position_qty, mark_price, funding_rate, amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, pos.id, market.id, at, pos.side, toDb(pos.qty), toDb(markPrice), rate.toFixed(10), toDb(amount)],
          );
        } catch (e) {
          if (isDuplicateKeyError(e, 'uq_funding_payment')) return false;
          throw e;
        }
        const wallet = [...wallets.values()][0]!;
        const meta = { type: 'FUNDING_FEE' as const, refType: 'FUNDING', refId: `${market.id}:${fundingTime}` };
        const changes: BalanceChange[] = [];
        if (amount.gte(0)) {
          changes.push({ userId, assetId: settle, account: 'FUTURES', available: amount, ...meta });
        } else {
          let due = amount.neg();
          // Isolated positions pay from their margin first; cross positions from available balance.
          const fromMargin = pos.marginMode === 'ISOLATED' ? dmin(due, pos.margin) : dmin(ZERO, due);
          if (fromMargin.gt(0)) {
            changes.push({ userId, assetId: settle, account: 'FUTURES', locked: fromMargin.neg(), ...meta });
            pos.margin = pos.margin.minus(fromMargin);
            due = due.minus(fromMargin);
          }
          const fromAvailable = dmin(due, wallet.available);
          if (fromAvailable.gt(0)) {
            changes.push({ userId, assetId: settle, account: 'FUTURES', available: fromAvailable.neg(), ...meta });
            due = due.minus(fromAvailable);
          }
          const fromPositionMargin = dmin(due, pos.margin);
          if (fromPositionMargin.gt(0)) {
            changes.push({ userId, assetId: settle, account: 'FUTURES', locked: fromPositionMargin.neg(), ...meta });
            pos.margin = pos.margin.minus(fromPositionMargin);
            due = due.minus(fromPositionMargin);
          }
          if (due.gt(0)) this.core.log.warn({ userId, due: due.toFixed() }, 'funding shortfall (account exhausted)');
        }
        pos.fundingFees = pos.fundingFees.plus(amount);
        pos.dirty = true;
        await this.core.wallet.apply(tx, changes, wallets);
        await this.core.futures.savePositions(tx, [pos]);
        return true;
      });
      if (paid) {
        count += 1;
        this.core.bus.emit('position.changed', { userId, marketId: market.id, marketType: 'FUTURES' });
        if (!this.core.users.isSystemUserCached(userId)) {
          const dto = (await this.core.futures.positionDtos(userId)).find((p) => p.symbol === market.symbol) ?? null;
          this.core.bus.ws(userChannel(userId, 'positions'), 'position', { marketType: 'FUTURES', symbol: market.symbol, futures: dto });
        }
      }
    }
    await this.core.db.execute('UPDATE funding_rates SET settled_at = CURRENT_TIMESTAMP(3) WHERE market_id = ? AND funding_time = ?', [market.id, at]);
    metrics.fundingPayments.inc(count);
    this.core.log.info({ symbol: market.symbol, fundingTime, rate: rate.toFixed(), positions: count }, 'funding settled');
    return count;
  }

  /** Predicted funding rate published by market-data (Redis), defaults to the interest rate. */
  async predictedRate(market: MarketInfo): Promise<Decimal> {
    const mp = await this.core.prices.markPrice(market.symbol);
    return mp ? D(mp.fundingRate) : D(market.futures?.interestRate ?? '0.0001');
  }
}
