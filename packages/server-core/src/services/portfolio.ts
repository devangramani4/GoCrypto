import type { AllocationItemDto, HoldingDto, PerformancePointDto, PortfolioSummaryDto } from '@gocrypto/shared-types';
import { D, type Decimal, ZERO, toDb, toPlain } from '@gocrypto/trading-utils';
import type { Core } from '../core';
import { toMsStrict } from '../db/database';

const RANGES: Record<string, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, '90d': 90 * 86_400_000, '1y': 365 * 86_400_000 };

/** Portfolio valuation, P&L, ROI, allocation and performance history. */
export class PortfolioService {
  constructor(private readonly core: Core) {}

  private async valuation(userId: string) {
    const prices = await this.core.prices.usdPrices();
    const wallets = await this.core.wallet.listWallets(this.core.db, userId);
    let spotValue = ZERO;
    let spotAvailable = ZERO;
    const perAsset = new Map<string, Decimal>();
    for (const w of wallets.filter((x) => x.account === 'SPOT')) {
      const asset = this.core.assets.symbolOf(w.assetId);
      const price = D(prices.get(asset) ?? '0');
      const value = w.available.plus(w.locked).mul(price);
      spotValue = spotValue.plus(value);
      spotAvailable = spotAvailable.plus(w.available.mul(price));
      perAsset.set(asset, (perAsset.get(asset) ?? ZERO).plus(value));
    }
    const futures = await this.core.futures.accountDto(userId);
    const options = await this.core.options.accountDto(userId);
    const futuresValue = D(futures.marginBalance);
    const optionsValue = D(options.equity);
    perAsset.set('USDT', (perAsset.get('USDT') ?? ZERO).plus(futuresValue).plus(optionsValue));
    return { spotValue, spotAvailable, futures, options, futuresValue, optionsValue, perAsset, prices };
  }

  private async flows(userId: string, since?: Date): Promise<{ inflow: Decimal; outflow: Decimal }> {
    const prices = await this.core.prices.usdPrices();
    const cond = since ? 'AND created_at >= ?' : '';
    const params = since ? [userId, since] : [userId];
    const deposits = await this.core.db.query<{ asset_id: number; s: string }>(
      `SELECT asset_id, SUM(amount) AS s FROM deposits WHERE user_id = ? AND status = 'COMPLETED' ${cond} GROUP BY asset_id`,
      params,
    );
    const seeded = await this.core.db.query<{ asset_id: number; s: string }>(
      `SELECT asset_id, SUM(available_delta) AS s FROM wallet_transactions WHERE user_id = ? AND type = 'ADJUSTMENT' ${cond} GROUP BY asset_id`,
      params,
    );
    const transfersIn = await this.core.db.query<{ asset_id: number; s: string }>(
      `SELECT asset_id, SUM(amount) AS s FROM transfers WHERE to_user_id = ? AND type = 'USER' ${cond} GROUP BY asset_id`,
      params,
    );
    const transfersOut = await this.core.db.query<{ asset_id: number; s: string }>(
      `SELECT asset_id, SUM(amount) AS s FROM transfers WHERE from_user_id = ? AND type = 'USER' ${cond} GROUP BY asset_id`,
      params,
    );
    const withdrawals = await this.core.db.one<{ s: string | null }>(
      `SELECT SUM(amount_usd) AS s FROM withdrawals WHERE user_id = ? AND status = 'COMPLETED' ${cond}`,
      params,
    );
    const usd = (rows: { asset_id: number; s: string }[]) =>
      rows.reduce((acc, r) => acc.plus(D(r.s).mul(prices.get(this.core.assets.symbolOf(Number(r.asset_id))) ?? '0')), ZERO);
    return {
      inflow: usd(deposits).plus(usd(seeded)).plus(usd(transfersIn)),
      outflow: D(withdrawals?.s ?? 0).plus(usd(transfersOut)),
    };
  }

  async summary(userId: string): Promise<PortfolioSummaryDto> {
    const v = await this.valuation(userId);
    const total = v.spotValue.plus(v.futuresValue).plus(v.optionsValue);
    const realized = await this.core.db.one<{ s: string | null }>(
      "SELECT SUM(realized_pnl) AS s FROM order_fills WHERE user_id = ? AND market_type = 'FUTURES'",
      [userId],
    );
    const funding = await this.core.db.one<{ s: string | null }>('SELECT SUM(amount) AS s FROM funding_payments WHERE user_id = ?', [userId]);
    const optSettle = await this.core.db.one<{ s: string | null }>('SELECT SUM(payout) AS s FROM options_settlements WHERE user_id = ?', [userId]);
    const all = await this.flows(userId);
    const startOfDay = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const today = await this.flows(userId, startOfDay);
    const snap = await this.core.db.one<{ total_value: string }>(
      'SELECT total_value FROM portfolio_snapshots WHERE user_id = ? AND snapshot_at <= ? ORDER BY snapshot_at DESC LIMIT 1',
      [userId, startOfDay],
    );
    const startValue = snap ? D(snap.total_value) : null;
    const todayPnl = startValue ? total.minus(startValue).minus(today.inflow.minus(today.outflow)) : ZERO;
    const net = all.inflow.minus(all.outflow);
    const openOrders = await this.core.orders.countOpen(userId);
    const positions = await this.core.db.one<{ c: number }>(
      `SELECT (SELECT COUNT(*) FROM futures_positions WHERE user_id = ? AND status = 'OPEN' AND quantity > 0)
            + (SELECT COUNT(*) FROM options_positions WHERE user_id = ? AND status = 'OPEN' AND quantity > 0) AS c`,
      [userId, userId],
    );
    const usedMargin = D(v.futures.positionMargin).plus(v.futures.orderMargin).plus(v.options.marginUsed);
    const available = v.spotAvailable.plus(v.futures.availableBalance).plus(v.options.availableBalance);
    const f2 = (d: Decimal) => toPlain(d.toDecimalPlaces(2));
    return {
      totalValue: f2(total),
      availableBalance: f2(available),
      usedMargin: f2(usedMargin),
      unrealizedPnl: f2(D(v.futures.unrealizedPnl).plus(v.options.unrealizedPnl)),
      realizedPnl: f2(D(realized?.s ?? 0).plus(funding?.s ?? 0).plus(optSettle?.s ?? 0)),
      todayPnl: f2(todayPnl),
      todayPnlPercent: startValue && startValue.gt(0) ? toPlain(todayPnl.div(startValue).toDecimalPlaces(6)) : '0',
      totalDeposits: f2(all.inflow),
      totalWithdrawals: f2(all.outflow),
      roi: net.gt(0) ? toPlain(total.minus(net).div(net).toDecimalPlaces(6)) : '0',
      spotValue: f2(v.spotValue),
      futuresValue: f2(v.futuresValue),
      optionsValue: f2(v.optionsValue),
      openOrders,
      openPositions: Number(positions?.c ?? 0),
      ts: Date.now(),
    };
  }

  async allocation(userId: string): Promise<AllocationItemDto[]> {
    const v = await this.valuation(userId);
    const total = [...v.perAsset.values()].reduce((a, b) => a.plus(b), ZERO);
    return [...v.perAsset.entries()]
      .filter(([, value]) => value.gt('0.005'))
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([asset, value]) => ({
        asset,
        value: toPlain(value.toDecimalPlaces(2)),
        percent: total.gt(0) ? toPlain(value.div(total).toDecimalPlaces(6)) : '0',
      }));
  }

  async holdings(userId: string): Promise<HoldingDto[]> {
    const prices = await this.core.prices.usdPrices();
    const wallets = (await this.core.wallet.listWallets(this.core.db, userId, 'SPOT')).filter((w) => w.available.plus(w.locked).gt(0));
    const tickers = await this.core.prices.tickers(wallets.map((w) => `${this.core.assets.symbolOf(w.assetId)}USDT`));
    return wallets
      .map((w) => {
        const asset = this.core.assets.symbolOf(w.assetId);
        const qty = w.available.plus(w.locked);
        const price = D(prices.get(asset) ?? '0');
        return {
          asset,
          quantity: toPlain(qty),
          available: toPlain(w.available),
          locked: toPlain(w.locked),
          price: toPlain(price),
          usdValue: toPlain(qty.mul(price).toDecimalPlaces(2)),
          change24h: this.core.assets.bySymbol(asset)?.isStable ? '0' : (tickers.get(`${asset}USDT`)?.priceChangePercent ?? '0'),
        };
      })
      .sort((a, b) => D(b.usdValue).comparedTo(D(a.usdValue)));
  }

  async performance(userId: string, range: string): Promise<PerformancePointDto[]> {
    const span = RANGES[range] ?? RANGES['30d']!;
    const rows = await this.core.db.query<{ snapshot_at: Date; total_value: string }>(
      'SELECT snapshot_at, total_value FROM portfolio_snapshots WHERE user_id = ? AND snapshot_at >= ? ORDER BY snapshot_at',
      [userId, new Date(Date.now() - span)],
    );
    const points = rows.map((r) => ({ t: toMsStrict(r.snapshot_at), value: toPlain(D(r.total_value).toDecimalPlaces(2)) }));
    const now = await this.summary(userId);
    points.push({ t: Date.now(), value: now.totalValue });
    return points;
  }

  /** Persist a valuation snapshot (hourly, by the workers service). */
  async snapshot(userId: string, at: Date): Promise<void> {
    const v = await this.valuation(userId);
    const flows = await this.flows(userId);
    const total = v.spotValue.plus(v.futuresValue).plus(v.optionsValue);
    await this.core.db.execute(
      `INSERT INTO portfolio_snapshots (user_id, snapshot_at, total_value, spot_value, futures_value, options_value, net_deposits)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE total_value = VALUES(total_value)`,
      [userId, at, toDb(total), toDb(v.spotValue), toDb(v.futuresValue), toDb(v.optionsValue), toDb(flows.inflow.minus(flows.outflow))],
    );
  }
}
