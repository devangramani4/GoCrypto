import type {
  AdminDashboardDto,
  AdminRoleDto,
  AdminUserDetailDto,
  AdminUserListItemDto,
  MarketType,
  Permission,
  RevenueReportRowDto,
  SecurityAlertDto,
  ServiceHealthDto,
  SystemHealthDto,
  UserRole,
  UserStatus,
} from '@gocrypto/shared-types';
import { ALL_PERMISSIONS } from '@gocrypto/shared-types';
import { D, ZERO, perpSymbol, toPlain } from '@gocrypto/trading-utils';
import type { Core } from '../core';
import { parseJson, toMs, toMsStrict } from '../db/database';
import { AppError } from '../errors';
import { key } from '../redis';
import type { UserRow } from './users';
import type { OrderRow } from './orders';
import type { WithdrawalRow } from './wallet-ops';

type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

function pageOf<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize };
}

/** Back-office queries and commands. Every mutation is audited by the caller (API layer). */
export class AdminService {
  constructor(private readonly core: Core) {}

  // ───────────────────────── dashboard ─────────────────────────

  async dashboard(): Promise<AdminDashboardDto> {
    const db = this.core.db;
    const users = await db.one<{ total: number; new24h: number; active24h: number; frozen: number }>(
      `SELECT COUNT(*) AS total,
              SUM(created_at >= NOW(3) - INTERVAL 1 DAY) AS new24h,
              SUM(last_login_at >= NOW(3) - INTERVAL 1 DAY) AS active24h,
              SUM(status = 'FROZEN') AS frozen
         FROM users WHERE is_system = 0 AND deleted_at IS NULL`,
    );
    const prices = await this.core.prices.usdPrices();
    const volRows = await db.query<{ quote_asset_id: number; q: string; n: number }>(
      `SELECT m.quote_asset_id, SUM(t.quote_quantity) AS q, COUNT(*) AS n FROM trades t JOIN markets m ON m.id = t.market_id
        WHERE t.created_at >= NOW(3) - INTERVAL 1 DAY GROUP BY m.quote_asset_id`,
    );
    const usd = (assetId: number, amount: string) => D(amount).mul(prices.get(this.core.assets.symbolOf(assetId)) ?? '0');
    const volume = volRows.reduce((a, r) => a.plus(usd(Number(r.quote_asset_id), r.q)), ZERO);
    const trades = volRows.reduce((a, r) => a + Number(r.n), 0);
    const feeUser = this.core.users.systemIds.feeCollector;
    const feeRows = (days: number) =>
      db.query<{ asset_id: number; s: string }>(
        `SELECT asset_id, SUM(available_delta) AS s FROM wallet_transactions WHERE user_id = ? AND type = 'FEE_REVENUE'
          AND created_at >= NOW(3) - INTERVAL ? DAY GROUP BY asset_id`,
        [feeUser, days],
      );
    const fees = async (days: number) => (await feeRows(days)).reduce((a, r) => a.plus(usd(Number(r.asset_id), r.s)), ZERO);
    const openOrders = await db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders o JOIN users u ON u.id = o.user_id WHERE u.is_system = 0 AND o.status IN ('NEW','OPEN','PARTIALLY_FILLED')",
    );
    const openPositions = await db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM futures_positions p JOIN users u ON u.id = p.user_id WHERE u.is_system = 0 AND p.status = 'OPEN' AND p.quantity > 0",
    );
    const pendingW = await db.one<{ c: number }>("SELECT COUNT(*) AS c FROM withdrawals WHERE status IN ('PENDING_REVIEW','APPROVED','PROCESSING')");
    const dep = await db.query<{ asset_id: number; s: string }>(
      "SELECT asset_id, SUM(amount) AS s FROM deposits WHERE status = 'COMPLETED' AND credited_at >= NOW(3) - INTERVAL 1 DAY GROUP BY asset_id",
    );
    const wd = await db.one<{ s: string | null }>(
      "SELECT SUM(amount_usd) AS s FROM withdrawals WHERE status = 'COMPLETED' AND completed_at >= NOW(3) - INTERVAL 1 DAY",
    );
    const alerts = await db.one<{ c: number }>('SELECT COUNT(*) AS c FROM security_alerts WHERE resolved_at IS NULL');
    const failed = await db.one<{ c: number }>('SELECT COUNT(*) AS c FROM login_history WHERE success = 0 AND created_at >= NOW(3) - INTERVAL 1 DAY');
    const series = await db.query<{ h: string; q: string; quote_asset_id: number }>(
      `SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d %H:00:00') AS h, m.quote_asset_id, SUM(t.quote_quantity) AS q
         FROM trades t JOIN markets m ON m.id = t.market_id
        WHERE t.created_at >= NOW(3) - INTERVAL 1 DAY GROUP BY h, m.quote_asset_id ORDER BY h`,
    );
    const byHour = new Map<string, ReturnType<typeof D>>();
    for (const r of series) byHour.set(r.h, (byHour.get(r.h) ?? ZERO).plus(usd(Number(r.quote_asset_id), r.q)));
    const feeSeries = await db.query<{ h: string; asset_id: number; s: string }>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS h, asset_id, SUM(available_delta) AS s FROM wallet_transactions
        WHERE user_id = ? AND type = 'FEE_REVENUE' AND created_at >= NOW(3) - INTERVAL 1 DAY GROUP BY h, asset_id`,
      [feeUser],
    );
    const feesByHour = new Map<string, ReturnType<typeof D>>();
    for (const r of feeSeries) feesByHour.set(r.h, (feesByHour.get(r.h) ?? ZERO).plus(usd(Number(r.asset_id), r.s)));
    const hours = [...new Set([...byHour.keys(), ...feesByHour.keys()])].sort();
    return {
      users: {
        total: Number(users?.total ?? 0),
        new24h: Number(users?.new24h ?? 0),
        active24h: Number(users?.active24h ?? 0),
        frozen: Number(users?.frozen ?? 0),
      },
      trading: {
        volume24hUsd: toPlain(volume.toDecimalPlaces(2)),
        trades24h: trades,
        openOrders: Number(openOrders?.c ?? 0),
        openPositions: Number(openPositions?.c ?? 0),
      },
      wallet: {
        pendingWithdrawals: Number(pendingW?.c ?? 0),
        deposits24hUsd: toPlain(dep.reduce((a, r) => a.plus(usd(Number(r.asset_id), r.s)), ZERO).toDecimalPlaces(2)),
        withdrawals24hUsd: toPlain(D(wd?.s ?? 0).toDecimalPlaces(2)),
      },
      revenue: { fees24hUsd: toPlain((await fees(1)).toDecimalPlaces(2)), fees30dUsd: toPlain((await fees(30)).toDecimalPlaces(2)) },
      security: { openAlerts: Number(alerts?.c ?? 0), failedLogins24h: Number(failed?.c ?? 0) },
      volumeSeries: hours.map((h) => ({
        t: new Date(`${h.replace(' ', 'T')}Z`).getTime(),
        volumeUsd: toPlain((byHour.get(h) ?? ZERO).toDecimalPlaces(2)),
        feesUsd: toPlain((feesByHour.get(h) ?? ZERO).toDecimalPlaces(2)),
      })),
    };
  }

  // ───────────────────────── users ─────────────────────────

  private async listItem(r: UserRow & { totp_enabled?: boolean }): Promise<AdminUserListItemDto> {
    return {
      id: String(r.id),
      uid: r.uid,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      status: r.status,
      tradingEnabled: Boolean(r.trading_enabled),
      withdrawalsEnabled: Boolean(r.withdrawals_enabled),
      twoFactorEnabled: Boolean(r.totp_enabled),
      emailVerified: r.email_verified_at != null,
      kycLevel: Number(r.kyc_level),
      vipTier: Number(r.vip_tier),
      createdAt: toMsStrict(r.created_at),
      lastLoginAt: toMs(r.last_login_at),
    };
  }

  async users(q: { page: number; pageSize: number; q?: string; status?: UserStatus; role?: UserRole }): Promise<Page<AdminUserListItemDto>> {
    const where = ['u.deleted_at IS NULL', 'u.is_system = 0'];
    const params: unknown[] = [];
    if (q.q) {
      where.push('(u.email LIKE ? OR u.uid = ? OR u.id = ? OR u.display_name LIKE ? OR u.phone LIKE ?)');
      params.push(`%${q.q}%`, q.q, q.q, `%${q.q}%`, `%${q.q}%`);
    }
    if (q.status) {
      where.push('u.status = ?');
      params.push(q.status);
    }
    if (q.role) {
      where.push('u.role = ?');
      params.push(q.role);
    }
    const total = await this.core.db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM users u WHERE ${where.join(' AND ')}`, params);
    const rows = await this.core.db.query<UserRow & { totp_enabled: boolean }>(
      `SELECT u.*, s.totp_enabled FROM users u LEFT JOIN user_security s ON s.user_id = u.id
        WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return pageOf(await Promise.all(rows.map((r) => this.listItem(r))), Number(total?.c ?? 0), q.page, q.pageSize);
  }

  async userDetail(userId: string): Promise<AdminUserDetailDto> {
    const row = await this.core.db.one<UserRow & { totp_enabled: boolean; trading_pin_hash: string | null }>(
      'SELECT u.*, s.totp_enabled, s.trading_pin_hash FROM users u LEFT JOIN user_security s ON s.user_id = u.id WHERE u.id = ?',
      [userId],
    );
    if (!row) throw new AppError('NOT_FOUND', 'User not found');
    const base = await this.listItem(row);
    const openOrders = await this.core.orders.countOpen(userId);
    const positions = await this.core.db.one<{ c: number }>("SELECT COUNT(*) AS c FROM futures_positions WHERE user_id = ? AND status = 'OPEN' AND quantity > 0", [userId]);
    return {
      ...base,
      phone: row.phone,
      hasTradingPin: Boolean(row.trading_pin_hash),
      balances: await this.core.wallet.balances(userId),
      openOrders,
      openPositions: Number(positions?.c ?? 0),
      devices: await this.core.auth.devices(userId),
      sessions: await this.core.auth.sessions(userId, ''),
      recentLogins: (await this.core.auth.loginHistory(userId, 20)).items,
    };
  }

  async updateUser(userId: string, input: { role?: UserRole; vipTier?: number; kycLevel?: number; withdrawalsEnabled?: boolean; displayName?: string }) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.role) {
      sets.push('role = ?');
      params.push(input.role);
    }
    if (input.vipTier !== undefined) {
      sets.push('vip_tier = ?');
      params.push(input.vipTier);
    }
    if (input.kycLevel !== undefined) {
      sets.push('kyc_level = ?');
      params.push(input.kycLevel);
    }
    if (input.withdrawalsEnabled !== undefined) {
      sets.push('withdrawals_enabled = ?');
      params.push(input.withdrawalsEnabled ? 1 : 0);
    }
    if (input.displayName) {
      sets.push('display_name = ?');
      params.push(input.displayName);
    }
    if (!sets.length) return;
    const res = await this.core.db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND is_system = 0`, [...params, userId]);
    if (res.affectedRows === 0) throw new AppError('NOT_FOUND', 'User not found');
    this.core.users.invalidate(userId);
    this.core.fees.invalidateUser(userId);
  }

  async setStatus(userId: string, status: UserStatus, reason: string): Promise<void> {
    const res = await this.core.db.execute('UPDATE users SET status = ?, status_reason = ? WHERE id = ? AND is_system = 0', [status, reason, userId]);
    if (res.affectedRows === 0) throw new AppError('NOT_FOUND', 'User not found');
    this.core.users.invalidate(userId);
    if (status !== 'ACTIVE') await this.core.auth.revokeSessions(userId, 'ALL', `ACCOUNT_${status}`);
  }

  async setTrading(userId: string, enabled: boolean): Promise<void> {
    const res = await this.core.db.execute('UPDATE users SET trading_enabled = ? WHERE id = ? AND is_system = 0', [enabled ? 1 : 0, userId]);
    if (res.affectedRows === 0) throw new AppError('NOT_FOUND', 'User not found');
    this.core.users.invalidate(userId);
  }

  /** Sandbox-only manual balance adjustment (fully ledgered). */
  async adjustBalance(adminId: string, userId: string, input: { asset: string; account: 'SPOT' | 'FUTURES' | 'OPTIONS'; amount: string; reason: string }) {
    if (!this.core.config.isSandbox) throw new AppError('SANDBOX_ONLY', 'Manual adjustments are disabled outside sandbox mode');
    const asset = this.core.assets.require(input.asset);
    await this.core.wallet.ensureWallets(this.core.db, [{ userId, assetId: asset.id, account: input.account }]);
    await this.core.db.transaction(async (tx) => {
      await this.core.wallet.apply(tx, [
        { userId, assetId: asset.id, account: input.account, available: input.amount, type: 'ADJUSTMENT', refType: 'ADMIN', refId: adminId, description: input.reason.slice(0, 255) },
      ]);
    });
  }

  // ───────────────────────── markets ─────────────────────────

  async createSpotMarket(input: {
    base: string;
    quote: string;
    tickSize: string;
    stepSize: string;
    minQty: string;
    maxQty: string;
    minNotional: string;
    priceBand?: string;
    makerFeeRate?: string | null;
    takerFeeRate?: string | null;
    status: string;
  }): Promise<string> {
    const base = this.core.assets.require(input.base);
    const quote = this.core.assets.require(input.quote);
    const symbol = `${base.symbol}${quote.symbol}`;
    if (this.core.markets.bySymbol(symbol)) throw new AppError('CONFLICT', `${symbol} already exists`);
    await this.core.db.transaction(async (tx) => {
      const res = await tx.execute(
        `INSERT INTO markets (symbol, type, display_name, base_asset_id, quote_asset_id, status, tick_size, step_size, min_qty, max_qty,
           min_notional, price_band, maker_fee_rate, taker_fee_rate)
         VALUES (?, 'SPOT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [symbol, `${base.symbol}/${quote.symbol}`, base.id, quote.id, input.status, input.tickSize, input.stepSize, input.minQty, input.maxQty, input.minNotional, input.priceBand ?? '0.05', input.makerFeeRate ?? null, input.takerFeeRate ?? null],
      );
      await tx.execute('INSERT INTO trading_pairs (market_id, base_asset_id, quote_asset_id) VALUES (?, ?, ?)', [res.insertId, base.id, quote.id]);
    });
    await this.core.markets.load();
    this.core.configChanged('markets');
    return symbol;
  }

  async createFuturesMarket(input: {
    underlying: string;
    settleAsset: string;
    tickSize: string;
    stepSize: string;
    minQty: string;
    maxQty: string;
    minNotional: string;
    maxLeverage: number;
    defaultLeverage: number;
    fundingIntervalHours: number;
    priceBand?: string;
    makerFeeRate?: string | null;
    takerFeeRate?: string | null;
    status: string;
  }): Promise<string> {
    const u = this.core.assets.require(input.underlying);
    const s = this.core.assets.require(input.settleAsset);
    const symbol = perpSymbol(u.symbol, s.symbol);
    if (this.core.markets.bySymbol(symbol)) throw new AppError('CONFLICT', `${symbol} already exists`);
    await this.core.db.transaction(async (tx) => {
      const res = await tx.execute(
        `INSERT INTO markets (symbol, type, display_name, base_asset_id, quote_asset_id, status, tick_size, step_size, min_qty, max_qty, min_notional,
           price_band, maker_fee_rate, taker_fee_rate, sort_order)
         VALUES (?, 'FUTURES', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 200)`,
        [
          symbol,
          `${u.symbol}${s.symbol} Perpetual`,
          u.id,
          s.id,
          input.status,
          input.tickSize,
          input.stepSize,
          input.minQty,
          input.maxQty,
          input.minNotional,
          input.priceBand ?? '0.05',
          input.makerFeeRate ?? null,
          input.takerFeeRate ?? null,
        ],
      );
      await tx.execute(
        `INSERT INTO futures_contracts (market_id, underlying_asset_id, settle_asset_id, max_leverage, default_leverage, funding_interval_hours)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [res.insertId, u.id, s.id, input.maxLeverage, Math.min(input.defaultLeverage, input.maxLeverage), input.fundingIntervalHours],
      );
      await tx.execute(
        `INSERT INTO futures_risk_tiers (market_id, tier, max_notional, max_leverage, maintenance_margin_rate, maintenance_amount)
         VALUES (?, 1, 100000000, ?, ?, 0)`,
        [res.insertId, input.maxLeverage, D(1).div(input.maxLeverage).div(2).toFixed(6)],
      );
    });
    await this.core.markets.load();
    this.core.configChanged('markets');
    return symbol;
  }

  async updateMarket(marketId: number, input: Record<string, unknown>): Promise<void> {
    const map: Record<string, string> = {
      status: 'status',
      tickSize: 'tick_size',
      stepSize: 'step_size',
      minQty: 'min_qty',
      maxQty: 'max_qty',
      minNotional: 'min_notional',
      priceBand: 'price_band',
      makerFeeRate: 'maker_fee_rate',
      takerFeeRate: 'taker_fee_rate',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (input[k] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(input[k]);
      }
    }
    if (sets.length) await this.core.db.execute(`UPDATE markets SET ${sets.join(', ')} WHERE id = ?`, [...params, marketId]);
    const fSets: string[] = [];
    const fParams: unknown[] = [];
    if (input.maxLeverage !== undefined) {
      fSets.push('max_leverage = ?');
      fParams.push(input.maxLeverage);
    }
    if (input.defaultLeverage !== undefined) {
      fSets.push('default_leverage = ?');
      fParams.push(input.defaultLeverage);
    }
    if (fSets.length) await this.core.db.execute(`UPDATE futures_contracts SET ${fSets.join(', ')} WHERE market_id = ?`, [...fParams, marketId]);
    await this.core.markets.load();
    this.core.configChanged('markets');
  }

  async setRiskTiers(marketId: number, tiers: { tier: number; maxNotional: string; maxLeverage: number; maintenanceMarginRate: string; maintenanceAmount: string }[]) {
    const m = this.core.markets.requireId(marketId);
    if (m.type !== 'FUTURES') throw new AppError('BAD_REQUEST', 'Risk tiers apply to futures contracts only');
    const sorted = [...tiers].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < sorted.length; i++) {
      if (D(sorted[i]!.maxNotional).lte(sorted[i - 1]!.maxNotional)) throw new AppError('VALIDATION_ERROR', 'Tier notional bounds must increase');
    }
    await this.core.db.transaction(async (tx) => {
      await tx.execute('DELETE FROM futures_risk_tiers WHERE market_id = ?', [marketId]);
      for (const t of sorted) {
        await tx.execute(
          'INSERT INTO futures_risk_tiers (market_id, tier, max_notional, max_leverage, maintenance_margin_rate, maintenance_amount) VALUES (?, ?, ?, ?, ?, ?)',
          [marketId, t.tier, t.maxNotional, t.maxLeverage, t.maintenanceMarginRate, t.maintenanceAmount],
        );
      }
    });
    await this.core.markets.load();
    this.core.configChanged('markets');
  }

  // ───────────────────────── fees ─────────────────────────

  async setFeeSchedule(rows: { marketType: MarketType; vipTier: number; makerRate: string; takerRate: string }[], adminId: string) {
    await this.core.db.transaction(async (tx) => {
      for (const r of rows) {
        await tx.execute(
          `INSERT INTO fees (market_type, vip_tier, maker_rate, taker_rate, updated_by) VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE maker_rate = VALUES(maker_rate), taker_rate = VALUES(taker_rate), updated_by = VALUES(updated_by)`,
          [r.marketType, r.vipTier, r.makerRate, r.takerRate, adminId],
        );
      }
    });
    await this.core.fees.load();
    this.core.configChanged('fees');
  }

  async userFees(userId: string) {
    const rows = await this.core.db.query<Record<string, unknown>>('SELECT * FROM user_fees WHERE user_id = ?', [userId]);
    return rows.map((r) => ({
      userId,
      marketType: r.market_type as MarketType,
      makerRate: toPlain(String(r.maker_rate)),
      takerRate: toPlain(String(r.taker_rate)),
      expiresAt: toMs(r.expires_at),
    }));
  }

  async setUserFee(userId: string, input: { marketType: MarketType; makerRate: string; takerRate: string; expiresAt?: number | null }, adminId: string) {
    await this.core.db.execute(
      `INSERT INTO user_fees (user_id, market_type, maker_rate, taker_rate, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE maker_rate = VALUES(maker_rate), taker_rate = VALUES(taker_rate), expires_at = VALUES(expires_at)`,
      [userId, input.marketType, input.makerRate, input.takerRate, input.expiresAt ? new Date(input.expiresAt) : null, adminId],
    );
    this.core.fees.invalidateUser(userId);
    this.core.configChanged('fees');
  }

  async deleteUserFee(userId: string, marketType: MarketType) {
    await this.core.db.execute('DELETE FROM user_fees WHERE user_id = ? AND market_type = ?', [userId, marketType]);
    this.core.fees.invalidateUser(userId);
    this.core.configChanged('fees');
  }

  async updateAssetNetwork(asset: string, network: string, input: Record<string, unknown>) {
    const { link } = this.core.assets.requireAssetNetwork(asset, network);
    const map: Record<string, string> = {
      depositEnabled: 'deposit_enabled',
      withdrawEnabled: 'withdraw_enabled',
      withdrawalFee: 'withdrawal_fee',
      minWithdrawal: 'min_withdrawal',
      minDeposit: 'min_deposit',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (input[k] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(typeof input[k] === 'boolean' ? (input[k] ? 1 : 0) : input[k]);
      }
    }
    if (sets.length) await this.core.db.execute(`UPDATE asset_networks SET ${sets.join(', ')} WHERE id = ?`, [...params, link.id]);
    if (input.confirmations !== undefined) await this.core.db.execute('UPDATE networks SET confirmations = ? WHERE id = ?', [input.confirmations, link.networkId]);
    await this.core.assets.load();
    this.core.configChanged('assets');
  }

  // ───────────────────────── orders / trades ─────────────────────────

  async orders(q: { page: number; pageSize: number; userId?: string; symbol?: string; marketType?: MarketType; status?: string; from?: number; to?: number }) {
    const where = ['1=1'];
    const params: unknown[] = [];
    if (q.userId) {
      where.push('o.user_id = ?');
      params.push(q.userId);
    } else {
      where.push('u.is_system = 0');
    }
    if (q.symbol) {
      where.push('o.market_id = ?');
      params.push(this.core.markets.require(q.symbol).id);
    }
    if (q.marketType) {
      where.push('o.market_type = ?');
      params.push(q.marketType);
    }
    if (q.status === 'OPEN') where.push("o.status IN ('NEW','OPEN','PARTIALLY_FILLED')");
    else if (q.status) {
      where.push('o.status = ?');
      params.push(q.status);
    }
    if (q.from) {
      where.push('o.created_at >= ?');
      params.push(new Date(q.from));
    }
    if (q.to) {
      where.push('o.created_at <= ?');
      params.push(new Date(q.to));
    }
    const total = await this.core.db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')}`, params);
    const rows = await this.core.db.query<OrderRow & { email: string }>(
      `SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return pageOf(
      rows.map((r) => ({ ...this.core.orders.toDto(r), userId: String(r.user_id), userEmail: r.email })),
      Number(total?.c ?? 0),
      q.page,
      q.pageSize,
    );
  }

  async trades(q: { page: number; pageSize: number; symbol?: string; userId?: string; from?: number; to?: number }) {
    const where = ['1=1'];
    const params: unknown[] = [];
    if (q.symbol) {
      where.push('t.market_id = ?');
      params.push(this.core.markets.require(q.symbol).id);
    }
    if (q.userId) {
      where.push('(t.maker_user_id = ? OR t.taker_user_id = ?)');
      params.push(q.userId, q.userId);
    }
    if (q.from) {
      where.push('t.created_at >= ?');
      params.push(new Date(q.from));
    }
    if (q.to) {
      where.push('t.created_at <= ?');
      params.push(new Date(q.to));
    }
    const total = await this.core.db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM trades t WHERE ${where.join(' AND ')}`, params);
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT t.* FROM trades t WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return pageOf(
      rows.map((r) => ({
        id: String(r.id),
        symbol: this.core.markets.byId(Number(r.market_id))?.symbol ?? '',
        price: toPlain(String(r.price)),
        quantity: toPlain(String(r.quantity)),
        quoteQuantity: toPlain(String(r.quote_quantity)),
        takerSide: String(r.taker_side),
        makerUserId: String(r.maker_user_id),
        takerUserId: String(r.taker_user_id),
        makerFee: toPlain(String(r.maker_fee)),
        takerFee: toPlain(String(r.taker_fee)),
        isLiquidation: Boolean(r.is_liquidation),
        createdAt: toMsStrict(r.created_at),
      })),
      Number(total?.c ?? 0),
      q.page,
      q.pageSize,
    );
  }

  // ───────────────────────── wallet ─────────────────────────

  async deposits(q: { page: number; pageSize: number; userId?: string; status?: string; q?: string }) {
    const where = ['1=1'];
    const params: unknown[] = [];
    if (q.userId) {
      where.push('d.user_id = ?');
      params.push(q.userId);
    }
    if (q.status) {
      where.push('d.status = ?');
      params.push(q.status);
    }
    if (q.q) {
      where.push('(d.tx_hash = ? OR d.address = ? OR u.email LIKE ?)');
      params.push(q.q, q.q, `%${q.q}%`);
    }
    const total = await this.core.db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM deposits d JOIN users u ON u.id = d.user_id WHERE ${where.join(' AND ')}`, params);
    const rows = await this.core.db.query<Record<string, unknown> & { user_email: string; user_id: string }>(
      `SELECT d.*, u.email AS user_email FROM deposits d JOIN users u ON u.id = d.user_id WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    const items = rows.map((r) => ({ ...this.core.walletOps.depositDto(r), userId: String(r.user_id), userEmail: r.user_email }));
    return pageOf(items, Number(total?.c ?? 0), q.page, q.pageSize);
  }

  async withdrawals(q: { page: number; pageSize: number; status?: string; asset?: string; userId?: string }) {
    const where = ['1=1'];
    const params: unknown[] = [];
    if (q.status) {
      where.push('w.status = ?');
      params.push(q.status);
    }
    if (q.asset) {
      where.push('w.asset_id = ?');
      params.push(this.core.assets.require(q.asset).id);
    }
    if (q.userId) {
      where.push('w.user_id = ?');
      params.push(q.userId);
    }
    const total = await this.core.db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM withdrawals w WHERE ${where.join(' AND ')}`, params);
    const rows = await this.core.db.query<WithdrawalRow & { user_email: string; user_id: string; risk_score: number; amount_usd: string }>(
      `SELECT w.*, u.email AS user_email FROM withdrawals w JOIN users u ON u.id = w.user_id
        WHERE ${where.join(' AND ')} ORDER BY w.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    const items = rows.map((r) => ({
      ...this.core.walletOps.withdrawalDto(r),
      userId: String(r.user_id),
      userEmail: r.user_email,
      riskScore: Number(r.risk_score),
      amountUsd: toPlain(String(r.amount_usd)),
    }));
    return pageOf(items, Number(total?.c ?? 0), q.page, q.pageSize);
  }

  async systemWallets() {
    const ids = this.core.users.systemIds;
    const out: Record<string, unknown> = {};
    for (const [name, id] of Object.entries(ids)) out[name] = await this.core.wallet.balances(id, undefined, false);
    return out;
  }

  // ───────────────────────── reports ─────────────────────────

  async revenue(q: { from?: number; to?: number; groupBy: 'day' | 'week' | 'month' }): Promise<RevenueReportRowDto[]> {
    const fmt = q.groupBy === 'month' ? '%Y-%m' : q.groupBy === 'week' ? '%x-W%v' : '%Y-%m-%d';
    const from = new Date(q.from ?? Date.now() - 30 * 86_400_000);
    const to = new Date(q.to ?? Date.now());
    // Grouped by fee asset *and* quote asset so fees and volume are each in a single unit.
    const trading = await this.core.db.query<{ period: string; market_type: MarketType; fee_asset_id: number; quote_asset_id: number; fees: string; trades: number; volume: string }>(
      `SELECT DATE_FORMAT(f.created_at, '${fmt}') AS period, f.market_type, f.fee_asset_id, m.quote_asset_id,
              SUM(f.fee) AS fees, COUNT(*) AS trades, SUM(f.quote_quantity) AS volume
         FROM order_fills f JOIN users u ON u.id = f.user_id JOIN markets m ON m.id = f.market_id
        WHERE u.is_system = 0 AND f.created_at BETWEEN ? AND ?
        GROUP BY period, f.market_type, f.fee_asset_id, m.quote_asset_id ORDER BY period DESC`,
      [from, to],
    );
    const withdrawals = await this.core.db.query<{ period: string; asset_id: number; fees: string; n: number; volume: string }>(
      `SELECT DATE_FORMAT(completed_at, '${fmt}') AS period, asset_id, SUM(fee) AS fees, COUNT(*) AS n, SUM(amount) AS volume
         FROM withdrawals WHERE status = 'COMPLETED' AND completed_at BETWEEN ? AND ? GROUP BY period, asset_id`,
      [from, to],
    );
    return [
      ...trading.map((r) => ({
        period: r.period,
        marketType: r.market_type,
        asset: this.core.assets.symbolOf(Number(r.fee_asset_id)),
        fees: toPlain(r.fees),
        trades: Number(r.trades),
        volume: toPlain(r.volume),
        volumeAsset: this.core.assets.symbolOf(Number(r.quote_asset_id)),
      })),
      ...withdrawals.map((r) => ({
        period: r.period,
        marketType: 'WITHDRAWAL' as const,
        asset: this.core.assets.symbolOf(Number(r.asset_id)),
        fees: toPlain(r.fees),
        trades: Number(r.n),
        volume: toPlain(r.volume),
        volumeAsset: this.core.assets.symbolOf(Number(r.asset_id)),
      })),
    ];
  }

  async transactionReport(q: { from?: number; to?: number }) {
    const rows = await this.core.db.query<{ type: string; asset_id: number; n: number; available: string; locked: string }>(
      `SELECT w.type, w.asset_id, COUNT(*) AS n, SUM(w.available_delta) AS available, SUM(w.locked_delta) AS locked
         FROM wallet_transactions w JOIN users u ON u.id = w.user_id
        WHERE u.is_system = 0 AND w.created_at BETWEEN ? AND ? GROUP BY w.type, w.asset_id ORDER BY w.type`,
      [new Date(q.from ?? Date.now() - 30 * 86_400_000), new Date(q.to ?? Date.now())],
    );
    return rows.map((r) => ({
      type: r.type,
      asset: this.core.assets.symbolOf(Number(r.asset_id)),
      count: Number(r.n),
      availableDelta: toPlain(r.available),
      lockedDelta: toPlain(r.locked),
    }));
  }

  // ───────────────────────── security ─────────────────────────

  async logins(q: { page: number; pageSize: number; userId?: string; q?: string; status?: string }) {
    const where = ['1=1'];
    const params: unknown[] = [];
    if (q.userId) {
      where.push('l.user_id = ?');
      params.push(q.userId);
    }
    if (q.q) {
      where.push('(l.email LIKE ? OR l.ip = ?)');
      params.push(`%${q.q}%`, q.q);
    }
    if (q.status === 'FAILED') where.push('l.success = 0');
    if (q.status === 'SUCCESS') where.push('l.success = 1');
    const total = await this.core.db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM login_history l WHERE ${where.join(' AND ')}`, params);
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT l.* FROM login_history l WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return pageOf(
      rows.map((r) => ({
        id: String(r.id),
        userId: r.user_id == null ? null : String(r.user_id),
        email: (r.email as string | null) ?? null,
        method: String(r.method),
        success: Boolean(r.success),
        reason: (r.failure_reason as string | null) ?? null,
        ip: (r.ip as string | null) ?? null,
        userAgent: (r.user_agent as string | null) ?? null,
        platform: (r.platform as string | null) ?? null,
        createdAt: toMsStrict(r.created_at),
      })),
      Number(total?.c ?? 0),
      q.page,
      q.pageSize,
    );
  }

  async alerts(q: { page: number; pageSize: number; status?: string; type?: string }): Promise<Page<SecurityAlertDto>> {
    const where = ['1=1'];
    const params: unknown[] = [];
    if (q.status === 'OPEN') where.push('a.resolved_at IS NULL');
    if (q.status === 'RESOLVED') where.push('a.resolved_at IS NOT NULL');
    if (q.type) {
      where.push('a.type = ?');
      params.push(q.type);
    }
    const total = await this.core.db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM security_alerts a WHERE ${where.join(' AND ')}`, params);
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT a.*, u.email FROM security_alerts a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return pageOf(
      rows.map((r) => ({
        id: String(r.id),
        userId: r.user_id == null ? null : String(r.user_id),
        userEmail: (r.email as string | null) ?? null,
        type: r.type as SecurityAlertDto['type'],
        severity: r.severity as SecurityAlertDto['severity'],
        ip: (r.ip as string | null) ?? null,
        details: parseJson<Record<string, unknown> | null>(r.details, null),
        resolvedAt: toMs(r.resolved_at),
        createdAt: toMsStrict(r.created_at),
      })),
      Number(total?.c ?? 0),
      q.page,
      q.pageSize,
    );
  }

  async resolveAlert(id: string, adminId: string): Promise<void> {
    const res = await this.core.db.execute('UPDATE security_alerts SET resolved_at = CURRENT_TIMESTAMP(3), resolved_by = ? WHERE id = ? AND resolved_at IS NULL', [adminId, id]);
    if (res.affectedRows === 0) throw new AppError('NOT_FOUND', 'Alert not found or already resolved');
  }

  async ipMonitoring(hours = 24) {
    const rows = await this.core.db.query<{ ip: string; attempts: number; failures: number; users: number; last_seen: Date }>(
      `SELECT ip, COUNT(*) AS attempts, SUM(success = 0) AS failures, COUNT(DISTINCT user_id) AS users, MAX(created_at) AS last_seen
         FROM login_history WHERE created_at >= NOW(3) - INTERVAL ? HOUR AND ip IS NOT NULL
        GROUP BY ip ORDER BY failures DESC, attempts DESC LIMIT 100`,
      [hours],
    );
    return rows.map((r) => ({
      ip: r.ip,
      attempts: Number(r.attempts),
      failures: Number(r.failures),
      distinctUsers: Number(r.users),
      lastSeen: toMsStrict(r.last_seen),
      suspicious: Number(r.failures) >= 10 || Number(r.users) >= 5,
    }));
  }

  async deviceMonitoring(q: { page: number; pageSize: number }) {
    const total = await this.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM user_devices WHERE revoked_at IS NULL');
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT d.*, u.email FROM user_devices d JOIN users u ON u.id = d.user_id WHERE d.revoked_at IS NULL ORDER BY d.last_seen_at DESC LIMIT ? OFFSET ?`,
      [q.pageSize, (q.page - 1) * q.pageSize],
    );
    return pageOf(
      rows.map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        userEmail: String(r.email),
        name: (r.name as string | null) ?? null,
        platform: String(r.platform),
        lastIp: (r.last_ip as string | null) ?? null,
        lastSeenAt: toMsStrict(r.last_seen_at),
        trusted: Boolean(r.trusted),
      })),
      Number(total?.c ?? 0),
      q.page,
      q.pageSize,
    );
  }

  async twoFactorStats() {
    const r = await this.core.db.one<{ total: number; totp: number; pin: number; verified: number }>(
      `SELECT COUNT(*) AS total, SUM(s.totp_enabled) AS totp, SUM(s.trading_pin_hash IS NOT NULL) AS pin, SUM(u.email_verified_at IS NOT NULL) AS verified
         FROM users u JOIN user_security s ON s.user_id = u.id WHERE u.is_system = 0 AND u.deleted_at IS NULL`,
    );
    const total = Number(r?.total ?? 0);
    const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
    return {
      totalUsers: total,
      twoFactorEnabled: Number(r?.totp ?? 0),
      twoFactorPercent: pct(Number(r?.totp ?? 0)),
      pinSet: Number(r?.pin ?? 0),
      pinPercent: pct(Number(r?.pin ?? 0)),
      emailVerified: Number(r?.verified ?? 0),
      emailVerifiedPercent: pct(Number(r?.verified ?? 0)),
    };
  }

  // ───────────────────────── roles ─────────────────────────

  async roles(): Promise<AdminRoleDto[]> {
    const roles = await this.core.db.query<{ code: UserRole; name: string; description: string | null; is_system: boolean }>(
      'SELECT code, name, description, is_system FROM roles WHERE is_admin = 1 ORDER BY code',
    );
    return roles.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: Boolean(r.is_system),
      permissions: this.core.users.permissionsFor(r.code),
    }));
  }

  async setRolePermissions(role: UserRole, permissions: Permission[]): Promise<void> {
    if (role === 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'SUPER_ADMIN always holds every permission');
    if (role === 'USER') throw new AppError('FORBIDDEN', 'Regular users cannot hold admin permissions');
    const valid = permissions.filter((p) => ALL_PERMISSIONS.includes(p));
    await this.core.db.transaction(async (tx) => {
      await tx.execute('DELETE FROM role_permissions WHERE role_code = ?', [role]);
      for (const p of valid) await tx.execute('INSERT INTO role_permissions (role_code, permission_code) VALUES (?, ?)', [role, p]);
    });
    await this.core.users.loadRoles();
    this.core.configChanged('roles');
  }

  // ───────────────────────── system ─────────────────────────

  async systemHealth(): Promise<SystemHealthDto> {
    const redis = this.core.redis.main;
    // SCAN (not KEYS) so the health page never blocks Redis.
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', key('hb', '*'), 'COUNT', 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0' && keys.length < 1000);
    const beats = keys.length ? await redis.mget(keys) : [];
    const services: ServiceHealthDto[] = [];
    let wsConnections = 0;
    for (const raw of beats) {
      if (!raw) continue;
      const b = JSON.parse(raw) as Record<string, unknown> & { service: string; ts: number; connections?: number };
      if (b.service === 'websocket') wsConnections += Number(b.connections ?? 0);
      services.push({ name: `${b.service}`, status: Date.now() - b.ts < 20_000 ? 'UP' : 'DEGRADED', lastHeartbeat: b.ts, details: b });
    }
    for (const expected of ['api', 'websocket', 'matching-engine', 'risk-engine', 'market-data', 'workers']) {
      if (!services.some((s) => s.name === expected)) services.push({ name: expected, status: 'DOWN', lastHeartbeat: null, details: null });
    }
    let dbStatus: 'UP' | 'DOWN' = 'UP';
    let dbLatency: number | null = null;
    let connections: number | null = null;
    try {
      dbLatency = await this.core.db.ping();
      const c = await this.core.db.one<{ Value: string }>("SHOW STATUS LIKE 'Threads_connected'");
      connections = c ? Number(c.Value) : null;
    } catch {
      dbStatus = 'DOWN';
    }
    let redisStatus: 'UP' | 'DOWN' = 'UP';
    let redisLatency: number | null = null;
    let usedMemory: string | null = null;
    try {
      redisLatency = await this.core.redis.ping();
      const info = await redis.info('memory');
      usedMemory = /used_memory_human:(\S+)/.exec(info)?.[1] ?? null;
    } catch {
      redisStatus = 'DOWN';
    }
    const mem = process.memoryUsage();
    const { loadavg } = await import('node:os');
    return {
      services: services.sort((a, b) => a.name.localeCompare(b.name)),
      database: { status: dbStatus, latencyMs: dbLatency, connections },
      redis: { status: redisStatus, latencyMs: redisLatency, usedMemory },
      websocket: { connections: wsConnections },
      process: {
        uptimeSec: Math.round(process.uptime()),
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        cpuUserMicros: process.cpuUsage().user,
        loadAvg: loadavg(),
      },
    };
  }

  /** Total liabilities per asset vs. system (sandbox) holdings — basic proof-of-reserves view. */
  async balanceSheet() {
    const totals = await this.core.wallet.totalsByAsset();
    return totals.map((t) => ({ ...t, total: toPlain(D(t.available).plus(t.locked)) }));
  }

  async optionContracts(q: { page: number; pageSize: number; underlying?: string; status?: string }) {
    const list = this.core.markets
      .options(q.underlying)
      .filter((m) => !q.status || m.option!.status === q.status)
      .sort((a, b) => a.option!.expiryAt - b.option!.expiryAt || D(a.option!.strike).comparedTo(b.option!.strike));
    const page = list.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((m) => this.core.markets.toDto(m));
    return pageOf(page, list.length, q.page, q.pageSize);
  }
}
