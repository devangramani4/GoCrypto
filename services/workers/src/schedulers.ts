import { type Core, type EngineGateway, FundingService, OptionsLifecycleService, key } from '@gocrypto/server-core';
import { D } from '@gocrypto/trading-utils';

/**
 * Periodic jobs that must run on exactly one instance (leader-elected by the caller):
 *  funding settlement, option listing / expiry settlement, portfolio snapshots, data hygiene.
 */
export class Schedulers {
  private timers: NodeJS.Timeout[] = [];
  private readonly options: OptionsLifecycleService;
  private running = new Set<string>();

  constructor(
    private readonly core: Core,
    engine: EngineGateway,
  ) {
    this.options = new OptionsLifecycleService(core, engine);
  }

  start(): void {
    const every = (name: string, ms: number, fn: () => Promise<void>, immediate = false) => {
      const run = async () => {
        if (this.running.has(name)) return;
        this.running.add(name);
        try {
          await fn();
        } catch (e) {
          this.core.log.error({ err: e, job: name }, 'scheduled job failed');
        } finally {
          this.running.delete(name);
        }
      };
      this.timers.push(setInterval(() => void run(), ms));
      if (immediate) setTimeout(() => void run(), 3000);
    };
    every('funding', 15_000, () => this.funding(), true);
    every('options-list', 10 * 60_000, () => this.listOptions(), true);
    every('options-settle', 30_000, () => this.settleOptions(), true);
    every('snapshots', 60_000, () => this.snapshots(), true);
    every('maintenance', 10 * 60_000, () => this.maintenance());
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
  }

  /** Settle every perpetual whose funding time has passed (once per funding time). */
  async funding(now = Date.now()): Promise<void> {
    for (const m of this.core.markets.list('FUTURES')) {
      if (!m.futures || m.status !== 'TRADING') continue;
      const interval = m.futures.fundingIntervalHours * 3_600_000;
      const due = Math.floor(now / interval) * interval;
      const marker = key('funding', 'settled', m.id);
      const last = Number((await this.core.redis.main.get(marker)) ?? 0);
      if (last >= due) continue;
      if (!last) {
        // First run: start from the current period without back-charging history.
        await this.core.redis.main.set(marker, String(due));
        continue;
      }
      const mp = await this.core.prices.markPrice(m.symbol);
      if (!mp) continue;
      await this.core.funding.settle(m, due, D(mp.fundingRate), D(mp.markPrice), D(mp.indexPrice));
      await this.core.redis.main.set(marker, String(due));
    }
  }

  async listOptions(): Promise<void> {
    for (const underlying of ['BTC', 'ETH', 'SOL']) {
      if (!this.core.assets.bySymbol(underlying)) continue;
      await this.options.listContracts(underlying);
    }
  }

  async settleOptions(): Promise<void> {
    await this.options.settleExpired();
  }

  /** Hourly valuation snapshots (performance charts, daily P&L). */
  async snapshots(now = Date.now()): Promise<void> {
    const hour = Math.floor(now / 3_600_000) * 3_600_000;
    const marker = key('snapshots', 'last');
    if (Number((await this.core.redis.main.get(marker)) ?? 0) >= hour) return;
    const users = await this.core.db.query<{ id: string }>(
      `SELECT DISTINCT u.id FROM users u JOIN wallets w ON w.user_id = u.id
        WHERE u.is_system = 0 AND u.deleted_at IS NULL AND (w.available > 0 OR w.locked > 0)`,
    );
    for (const u of users) {
      await this.core.portfolio.snapshot(String(u.id), new Date(hour)).catch((e) => this.core.log.warn({ err: e, userId: u.id }, 'snapshot failed'));
    }
    await this.core.redis.main.set(marker, String(hour));
    this.core.log.info({ users: users.length }, 'portfolio snapshots written');
  }

  /** Keep high-churn tables lean: drop unfilled system quotes that were cancelled long ago. */
  async maintenance(): Promise<void> {
    const ids = Object.values(this.core.users.systemIds).filter((x) => x !== '0');
    if (!ids.length) return;
    const cutoff = new Date(Date.now() - 6 * 3_600_000);
    for (;;) {
      const rows = await this.core.db.query<{ id: string }>(
        `SELECT id FROM orders WHERE user_id IN (${ids.map(() => '?').join(',')}) AND status IN ('CANCELLED','EXPIRED')
           AND filled_quantity = 0 AND updated_at < ? LIMIT 2000`,
        [...ids, cutoff],
      );
      if (!rows.length) break;
      const list = rows.map((r) => r.id);
      await this.core.db.transaction(async (tx) => {
        await tx.execute(`DELETE FROM order_history WHERE order_id IN (${list.map(() => '?').join(',')})`, list);
        await tx.execute(`DELETE FROM orders WHERE id IN (${list.map(() => '?').join(',')})`, list);
      });
      if (rows.length < 2000) break;
    }
    await this.core.db.execute('DELETE FROM user_sessions WHERE expires_at < NOW(3) - INTERVAL 7 DAY');
  }
}
