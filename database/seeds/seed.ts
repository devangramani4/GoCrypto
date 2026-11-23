import { ADMIN_ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, USER_ROLES } from '@gocrypto/shared-types';
import { type Core, SYSTEM_EMAILS, hashPassword, isDuplicateKeyError, randomToken } from '@gocrypto/server-core';
import { perpSymbol } from '@gocrypto/trading-utils';
import {
  ASSETS,
  ASSET_NETWORKS,
  DEMO_BALANCES,
  FEE_SCHEDULE,
  FUTURES_MARKETS,
  INSURANCE_FUND_BALANCES,
  MARKET_MAKER_BALANCES,
  NETWORKS,
  ROLE_NAMES,
  SPOT_MARKETS,
  withMaintenanceAmounts,
} from './data';

export interface SeedOptions {
  adminEmail?: string;
  adminPassword?: string;
  demoUser?: boolean;
  log?: (msg: string) => void;
}

export interface SeedResult {
  adminEmail: string;
  adminPassword: string | null;
  demoEmail: string | null;
  demoPassword: string | null;
}

export const DEMO_EMAIL = 'demo@gocrypto.local';
export const DEMO_PASSWORD = 'DemoTrader2026!';

/** Idempotent seed: safe to run repeatedly. */
export async function runSeed(core: Core, opts: SeedOptions = {}): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const db = core.db;

  // ── RBAC ──
  for (const role of USER_ROLES) {
    const [name, description] = ROLE_NAMES[role] ?? [role, null];
    await db.execute(
      `INSERT INTO roles (code, name, description, is_system, is_admin) VALUES (?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
      [role, name, description, ADMIN_ROLES.includes(role) ? 1 : 0],
    );
  }
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await db.execute(
      `INSERT INTO permissions (code, description, category) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description), category = VALUES(category)`,
      [code, description, code.split('.')[0]],
    );
  }
  const existingGrants = await db.one<{ c: number }>('SELECT COUNT(*) AS c FROM role_permissions');
  if (Number(existingGrants?.c ?? 0) === 0) {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) await db.execute('INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES (?, ?)', [role, p]);
    }
  } else {
    // SUPER_ADMIN always holds every permission (new permissions included).
    for (const p of Object.keys(PERMISSIONS)) {
      await db.execute('INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES (?, ?)', ['SUPER_ADMIN', p]);
    }
  }
  log('roles & permissions');

  // ── assets & networks ──
  for (const a of ASSETS) {
    await db.execute(
      `INSERT INTO assets (symbol, name, decimals, is_stable, sort_order) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), decimals = VALUES(decimals), is_stable = VALUES(is_stable), sort_order = VALUES(sort_order)`,
      [a.symbol, a.name, a.decimals, a.stable ? 1 : 0, a.sort],
    );
  }
  for (const n of NETWORKS) {
    await db.execute(
      `INSERT INTO networks (code, name, address_format, confirmations, memo_supported, explorer_tx_url) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), address_format = VALUES(address_format), explorer_tx_url = VALUES(explorer_tx_url)`,
      [n.code, n.name, n.format, n.confirmations, n.memo ? 1 : 0, n.explorer],
    );
  }
  const assetId = async (s: string) => Number((await db.one<{ id: number }>('SELECT id FROM assets WHERE symbol = ?', [s]))!.id);
  const networkId = async (c: string) => Number((await db.one<{ id: number }>('SELECT id FROM networks WHERE code = ?', [c]))!.id);
  for (const [asset, network, fee, minW, minD, precision] of ASSET_NETWORKS) {
    await db.execute(
      `INSERT INTO asset_networks (asset_id, network_id, withdrawal_fee, min_withdrawal, min_deposit, withdrawal_precision)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE asset_id = asset_id`,
      [await assetId(asset), await networkId(network), fee, minW, minD, precision],
    );
  }
  log('assets & networks');

  // ── spot markets ──
  for (const m of SPOT_MARKETS) {
    const symbol = `${m.base}${m.quote}`;
    const base = await assetId(m.base);
    const quote = await assetId(m.quote);
    await db.execute(
      `INSERT INTO markets (symbol, type, display_name, base_asset_id, quote_asset_id, tick_size, step_size, min_qty, max_qty, min_notional, sort_order)
       VALUES (?, 'SPOT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      [symbol, `${m.base}/${m.quote}`, base, quote, m.tick, m.step, m.minQty, m.maxQty, m.minNotional, m.sort],
    );
    const id = Number((await db.one<{ id: number }>('SELECT id FROM markets WHERE symbol = ?', [symbol]))!.id);
    await db.execute('INSERT IGNORE INTO trading_pairs (market_id, base_asset_id, quote_asset_id) VALUES (?, ?, ?)', [id, base, quote]);
  }
  log('spot markets');

  // ── perpetual futures ──
  const usdt = await assetId('USDT');
  for (const f of FUTURES_MARKETS) {
    const symbol = perpSymbol(f.underlying, 'USDT');
    const base = await assetId(f.underlying);
    await db.execute(
      `INSERT INTO markets (symbol, type, display_name, base_asset_id, quote_asset_id, tick_size, step_size, min_qty, max_qty, min_notional, price_band, sort_order)
       VALUES (?, 'FUTURES', ?, ?, ?, ?, ?, ?, ?, 5, 0.05, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      [symbol, `${f.underlying}USDT Perpetual`, base, usdt, f.tick, f.step, f.minQty, f.maxQty, 100 + f.sort],
    );
    const id = Number((await db.one<{ id: number }>('SELECT id FROM markets WHERE symbol = ?', [symbol]))!.id);
    await db.execute(
      `INSERT INTO futures_contracts (market_id, underlying_asset_id, settle_asset_id, max_leverage, default_leverage, funding_interval_hours)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE max_leverage = VALUES(max_leverage)`,
      [id, base, usdt, f.maxLeverage, f.defaultLeverage, core.config.FUNDING_INTERVAL_HOURS],
    );
    for (const t of withMaintenanceAmounts(f.tiers)) {
      await db.execute(
        `INSERT INTO futures_risk_tiers (market_id, tier, max_notional, max_leverage, maintenance_margin_rate, maintenance_amount)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE max_notional = VALUES(max_notional), max_leverage = VALUES(max_leverage),
           maintenance_margin_rate = VALUES(maintenance_margin_rate), maintenance_amount = VALUES(maintenance_amount)`,
        [id, t.tier, t.maxNotional, t.maxLeverage, t.mmr, t.maintenanceAmount],
      );
    }
  }
  log('futures contracts & risk tiers');

  // ── fees ──
  for (const [type, tier, maker, taker] of FEE_SCHEDULE) {
    await db.execute(
      `INSERT INTO fees (market_type, vip_tier, maker_rate, taker_rate) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE market_type = market_type`,
      [type, tier, maker, taker],
    );
  }
  log('fee schedule');

  await core.reloadAll();

  // ── system accounts ──
  const ensureUser = async (email: string, role: string, isSystem: boolean, password: string | null, displayName: string) => {
    const existing = await db.one<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return { id: String(existing.id), created: false };
    const id = await core.users.createUser(db, {
      email,
      passwordHash: password ? await hashPassword(password) : null,
      role: role as never,
      isSystem,
      emailVerified: true,
      displayName,
    });
    return { id, created: true };
  };

  const credit = async (userId: string, balances: ['SPOT' | 'FUTURES' | 'OPTIONS', string, string][], tag: string) => {
    for (const [account, asset, amount] of balances) {
      const a = core.assets.require(asset);
      try {
        await db.transaction((tx) =>
          core.wallet.apply(tx, [
            {
              userId,
              assetId: a.id,
              account,
              available: amount,
              type: 'ADJUSTMENT',
              refType: 'SEED',
              idemKey: `seed:${tag}:${userId}:${account}:${asset}`,
              description: 'Sandbox seed balance',
            },
          ]),
        );
      } catch (e) {
        if (!isDuplicateKeyError(e, 'uq_wtx_idem')) throw e;
      }
    }
  };

  const mm = await ensureUser(SYSTEM_EMAILS.marketMaker, 'USER', true, null, 'GoCrypto Market Maker');
  await ensureUser(SYSTEM_EMAILS.feeCollector, 'USER', true, null, 'GoCrypto Fee Collector');
  const ins = await ensureUser(SYSTEM_EMAILS.insuranceFund, 'USER', true, null, 'GoCrypto Insurance Fund');
  if (core.config.isSandbox) {
    await credit(mm.id, MARKET_MAKER_BALANCES, 'mm');
    await credit(ins.id, INSURANCE_FUND_BALANCES, 'ins');
  }
  log('system accounts');

  // ── admin ──
  const adminEmail = (opts.adminEmail ?? core.config.SEED_ADMIN_EMAIL).toLowerCase();
  const adminPasswordInput = opts.adminPassword ?? core.config.SEED_ADMIN_PASSWORD;
  const adminPassword = adminPasswordInput || `Adm!n-${randomToken(9)}`;
  const admin = await ensureUser(adminEmail, 'SUPER_ADMIN', false, adminPassword, 'Platform Admin');
  log(admin.created ? `admin user created: ${adminEmail}` : `admin user exists: ${adminEmail}`);

  // ── demo trader ──
  let demoCreated = false;
  const wantDemo = (opts.demoUser ?? core.config.SEED_DEMO_USER) && !core.config.isProduction && core.config.isSandbox;
  if (wantDemo) {
    const demo = await ensureUser(DEMO_EMAIL, 'USER', false, DEMO_PASSWORD, 'Demo Trader');
    demoCreated = demo.created;
    await credit(demo.id, DEMO_BALANCES, 'demo');
    log(`demo user ready: ${DEMO_EMAIL}`);
  }

  await core.users.load();
  return {
    adminEmail,
    adminPassword: admin.created ? adminPassword : null,
    demoEmail: wantDemo ? DEMO_EMAIL : null,
    demoPassword: wantDemo && demoCreated ? DEMO_PASSWORD : null,
  };
}
