import type { AccountType, BalanceDto, LedgerEntryDto, LedgerType } from '@gocrypto/shared-types';
import { userChannel } from '@gocrypto/shared-types';
import { D, type Decimal, type DecimalLike, toDb, toPlain } from '@gocrypto/trading-utils';
import type { Core } from '../core';
import { type Executor, type Tx, placeholders, toMsStrict } from '../db/database';
import { AppError, isDuplicateKeyError } from '../errors';
import { TtlCache } from '../cache/ttl-cache';

export interface WalletKey {
  userId: string;
  assetId: number;
  account: AccountType;
}

export interface WalletRow extends WalletKey {
  id: string;
  available: Decimal;
  locked: Decimal;
  version: number;
}

/** A single balance mutation; deltas may be negative. */
export interface BalanceChange extends WalletKey {
  available?: DecimalLike;
  locked?: DecimalLike;
  type: LedgerType;
  refType?: string | null;
  refId?: string | null;
  /** Globally unique key — a second application of the same change fails the transaction. */
  idemKey?: string | null;
  description?: string | null;
}

export function walletKey(k: WalletKey): string {
  return `${k.userId}:${k.account}:${k.assetId}`;
}

const ACCOUNT_ORDER: Record<AccountType, number> = { SPOT: 0, FUTURES: 1, OPTIONS: 2 };

function compareKeys(a: WalletKey, b: WalletKey): number {
  const ua = BigInt(a.userId);
  const ub = BigInt(b.userId);
  if (ua !== ub) return ua < ub ? -1 : 1;
  if (a.account !== b.account) return ACCOUNT_ORDER[a.account] - ACCOUNT_ORDER[b.account];
  return a.assetId - b.assetId;
}

interface WalletDbRow {
  id: string;
  user_id: string;
  asset_id: number;
  account_type: AccountType;
  available: string;
  locked: string;
  version: string;
}

function toWalletRow(r: WalletDbRow): WalletRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    assetId: Number(r.asset_id),
    account: r.account_type,
    available: D(r.available),
    locked: D(r.locked),
    version: Number(r.version),
  };
}

/**
 * The only code path allowed to change balances.
 *
 * Invariants:
 *  - every mutation happens inside a DB transaction holding row locks (SELECT ... FOR UPDATE),
 *    acquired in a deterministic order to avoid deadlocks;
 *  - every mutation appends an immutable ledger row (wallet_transactions);
 *  - balances can never become negative (application check + DB CHECK constraint);
 *  - a user's FUTURES/OPTIONS settle-asset wallet row doubles as the mutex for that user's
 *    positions: code that changes positions must lock the wallet first.
 */
export class WalletService {
  /** Wallet rows are never deleted, so "exists" can be cached (bounded) and most calls cost no query. */
  private readonly known = new TtlCache<string, true>(500_000, 6 * 3_600_000);

  constructor(private readonly core: Core) {}

  /**
   * Create missing wallet rows (autocommit, idempotent). Call before a transaction to avoid lock upgrades.
   *
   * Existing rows are detected with a plain (non-locking, READ COMMITTED) read and only genuinely missing
   * rows are inserted, in key order. A blanket INSERT IGNORE would take shared locks on every existing row
   * it touches — including hot system wallets (fee collector, insurance fund) that settlements hold FOR
   * UPDATE — which deadlocked or stalled settlement under load.
   */
  async ensureWallets(exec: Executor, keys: WalletKey[]): Promise<void> {
    const pending = [...new Map(keys.map((k) => [walletKey(k), k])).values()].filter(
      (k) => !this.known.get(walletKey(k)),
    );
    if (pending.length === 0) return;
    const rows = await exec.query<{ user_id: string; asset_id: number; account_type: AccountType }>(
      `SELECT user_id, asset_id, account_type FROM wallets WHERE (user_id, account_type, asset_id) IN (${pending.map(() => '(?, ?, ?)').join(', ')})`,
      pending.flatMap((k) => [k.userId, k.account, k.assetId]),
    );
    for (const r of rows)
      this.known.set(
        walletKey({ userId: String(r.user_id), assetId: Number(r.asset_id), account: r.account_type }),
        true,
      );
    const missing = pending.filter((k) => !this.known.get(walletKey(k))).sort(compareKeys);
    if (missing.length) {
      await exec.execute(
        `INSERT IGNORE INTO wallets (user_id, asset_id, account_type) VALUES ${missing.map(() => '(?, ?, ?)').join(', ')}`,
        missing.flatMap((k) => [k.userId, k.assetId, k.account]),
      );
      for (const k of missing) this.known.set(walletKey(k), true);
    }
  }

  /** Lock wallet rows FOR UPDATE in a deterministic order, creating any that are missing. */
  async lockWallets(tx: Tx, keys: WalletKey[], into = new Map<string, WalletRow>()): Promise<Map<string, WalletRow>> {
    const needed = [...new Map(keys.map((k) => [walletKey(k), k])).values()]
      .filter((k) => !into.has(walletKey(k)))
      .sort(compareKeys);
    if (needed.length === 0) return into;
    const select = async (ks: WalletKey[]) =>
      tx.query<WalletDbRow>(
        `SELECT id, user_id, asset_id, account_type, available, locked, version FROM wallets
          WHERE (user_id, account_type, asset_id) IN (${ks.map(() => '(?, ?, ?)').join(', ')})
          ORDER BY user_id, account_type, asset_id FOR UPDATE`,
        ks.flatMap((k) => [k.userId, k.account, k.assetId]),
      );
    for (const r of await select(needed)) {
      const w = toWalletRow(r);
      into.set(walletKey(w), w);
    }
    const missing = needed.filter((k) => !into.has(walletKey(k)));
    if (missing.length) {
      for (const k of missing) {
        try {
          await tx.execute('INSERT INTO wallets (user_id, asset_id, account_type) VALUES (?, ?, ?)', [
            k.userId,
            k.assetId,
            k.account,
          ]);
        } catch (e) {
          if (!isDuplicateKeyError(e)) throw e;
        }
      }
      for (const r of await select(missing)) {
        const w = toWalletRow(r);
        into.set(walletKey(w), w);
      }
    }
    return into;
  }

  /**
   * Apply balance changes atomically inside `tx`. Locks any wallets not already locked, validates
   * that no balance becomes negative, persists the new balances and appends ledger entries.
   * Publishes balance events after commit.
   */
  async apply(tx: Tx, changes: BalanceChange[], locked?: Map<string, WalletRow>): Promise<Map<string, WalletRow>> {
    const wallets = await this.lockWallets(
      tx,
      changes.map((c) => ({ userId: c.userId, assetId: c.assetId, account: c.account })),
      locked ?? new Map(),
    );
    const touched = new Map<string, WalletRow>();
    const ledger: unknown[][] = [];
    for (const c of changes) {
      const da = D(c.available ?? 0);
      const dl = D(c.locked ?? 0);
      if (da.isZero() && dl.isZero()) continue;
      const k = walletKey(c);
      const w = wallets.get(k);
      if (!w) throw new Error(`wallet ${k} not locked`);
      w.available = w.available.plus(da);
      w.locked = w.locked.plus(dl);
      touched.set(k, w);
      ledger.push([
        w.id,
        w.userId,
        w.assetId,
        w.account,
        c.type,
        toDb(da),
        toDb(dl),
        toDb(w.available),
        toDb(w.locked),
        c.refType ?? null,
        c.refId ?? null,
        c.idemKey ?? null,
        c.description ?? null,
      ]);
    }
    for (const w of touched.values()) {
      if (w.available.isNegative() || w.locked.isNegative()) {
        const asset = this.core.assets.symbolOf(w.assetId);
        throw new AppError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance in ${w.account} account`, {
          details: { asset, account: w.account },
        });
      }
    }
    // One round trip for all touched wallets (a settlement typically touches 4+). Rows are already locked
    // FOR UPDATE; the per-row version check stays as a defensive assertion.
    const rows = [...touched.values()];
    if (rows.length === 1) {
      const w = rows[0]!;
      const res = await tx.execute(
        'UPDATE wallets SET available = ?, locked = ?, version = version + 1 WHERE id = ? AND version = ?',
        [toDb(w.available), toDb(w.locked), w.id, w.version],
      );
      if (res.affectedRows !== 1) throw new Error(`wallet ${w.id} version conflict`);
    } else if (rows.length > 1) {
      const cases = rows.map(() => 'WHEN ? THEN ?').join(' ');
      const res = await tx.execute(
        `UPDATE wallets SET available = CASE id ${cases} END, locked = CASE id ${cases} END, version = version + 1
          WHERE id IN (${rows.map(() => '?').join(', ')}) AND version = CASE id ${cases} END`,
        [
          ...rows.flatMap((w) => [w.id, toDb(w.available)]),
          ...rows.flatMap((w) => [w.id, toDb(w.locked)]),
          ...rows.map((w) => w.id),
          ...rows.flatMap((w) => [w.id, w.version]),
        ],
      );
      if (res.affectedRows !== rows.length)
        throw new Error(`wallet version conflict (${res.affectedRows}/${rows.length} updated)`);
    }
    for (const w of rows) w.version += 1;
    if (ledger.length) {
      await tx.execute(
        `INSERT INTO wallet_transactions
          (wallet_id, user_id, asset_id, account_type, type, available_delta, locked_delta, available_after, locked_after,
           ref_type, ref_id, idem_key, description)
         VALUES ${ledger.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        ledger.flat(),
      );
    }
    if (touched.size) {
      const snapshot = [...touched.values()].map((w) => ({ ...w }));
      tx.afterCommit(() => this.publishBalances(snapshot));
    }
    return wallets;
  }

  /** Publish changed balances to each owner's private channel. */
  async publishBalances(rows: WalletRow[]): Promise<void> {
    const byUser = new Map<string, WalletRow[]>();
    for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
    const prices = await this.core.prices.usdPrices().catch(() => new Map<string, string>());
    for (const [userId, list] of byUser) {
      if (this.core.users.isSystemUserCached(userId)) continue;
      const dtos = list.map((w) => this.toDto(w, prices));
      this.core.bus.ws(userChannel(userId, 'balance'), 'balance', dtos);
      for (const account of new Set(list.map((w) => w.account))) {
        if (account !== 'SPOT') this.core.bus.emit('account.changed', { userId, account });
      }
    }
  }

  toDto(w: Pick<WalletRow, 'assetId' | 'account' | 'available' | 'locked'>, prices: Map<string, string>): BalanceDto {
    const asset = this.core.assets.symbolOf(w.assetId);
    const total = w.available.plus(w.locked);
    const price = prices.get(asset);
    return {
      asset,
      account: w.account,
      available: toPlain(w.available),
      locked: toPlain(w.locked),
      total: toPlain(total),
      usdValue: price ? total.mul(price).toDecimalPlaces(2).toFixed(2) : '0.00',
    };
  }

  async getWallet(exec: Executor, k: WalletKey): Promise<WalletRow | null> {
    const r = await exec.one<WalletDbRow>(
      'SELECT id, user_id, asset_id, account_type, available, locked, version FROM wallets WHERE user_id = ? AND account_type = ? AND asset_id = ?',
      [k.userId, k.account, k.assetId],
    );
    return r ? toWalletRow(r) : null;
  }

  async listWallets(exec: Executor, userId: string, account?: AccountType): Promise<WalletRow[]> {
    const rows = await exec.query<WalletDbRow>(
      `SELECT id, user_id, asset_id, account_type, available, locked, version FROM wallets
        WHERE user_id = ? ${account ? 'AND account_type = ?' : ''} ORDER BY account_type, asset_id`,
      account ? [userId, account] : [userId],
    );
    return rows.map(toWalletRow);
  }

  async balances(userId: string, account?: AccountType, includeZero = false): Promise<BalanceDto[]> {
    const prices = await this.core.prices.usdPrices();
    const rows = await this.listWallets(this.core.db, userId, account);
    const dtos = rows.map((w) => this.toDto(w, prices));
    return includeZero ? dtos : dtos.filter((b) => !D(b.total).isZero());
  }

  async ledger(
    userId: string,
    q: {
      cursor?: string;
      limit: number;
      asset?: string;
      account?: AccountType;
      type?: string;
      from?: number;
      to?: number;
    },
  ): Promise<{ items: LedgerEntryDto[]; nextCursor: string | null }> {
    const where = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (q.cursor) {
      where.push('id < ?');
      params.push(q.cursor);
    }
    if (q.asset) {
      where.push('asset_id = ?');
      params.push(this.core.assets.require(q.asset).id);
    }
    if (q.account) {
      where.push('account_type = ?');
      params.push(q.account);
    }
    if (q.type) {
      where.push('type = ?');
      params.push(q.type);
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
      `SELECT * FROM wallet_transactions WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      params,
    );
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: String(r.id),
        asset: this.core.assets.symbolOf(Number(r.asset_id)),
        account: r.account_type as AccountType,
        type: r.type as LedgerType,
        availableDelta: toPlain(String(r.available_delta)),
        lockedDelta: toPlain(String(r.locked_delta)),
        availableAfter: toPlain(String(r.available_after)),
        lockedAfter: toPlain(String(r.locked_after)),
        refType: (r.ref_type as string | null) ?? null,
        refId: (r.ref_id as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        createdAt: toMsStrict(r.created_at),
      })),
      nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
    };
  }

  /** Total balances per asset across all users (admin reporting). */
  async totalsByAsset(): Promise<
    { asset: string; account: AccountType; available: string; locked: string; users: number }[]
  > {
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT w.asset_id, w.account_type, SUM(w.available) AS available, SUM(w.locked) AS locked, COUNT(*) AS users
         FROM wallets w JOIN users u ON u.id = w.user_id
        WHERE u.is_system = 0 AND (w.available > 0 OR w.locked > 0)
        GROUP BY w.asset_id, w.account_type`,
    );
    return rows.map((r) => ({
      asset: this.core.assets.symbolOf(Number(r.asset_id)),
      account: r.account_type as AccountType,
      available: toPlain(String(r.available)),
      locked: toPlain(String(r.locked)),
      users: Number(r.users),
    }));
  }

  /** Lookup helper for IN lists. */
  async walletsByIds(exec: Executor, ids: string[]): Promise<WalletRow[]> {
    if (!ids.length) return [];
    const rows = await exec.query<WalletDbRow>(
      `SELECT id, user_id, asset_id, account_type, available, locked, version FROM wallets WHERE id IN (${placeholders(ids.length)})`,
      ids,
    );
    return rows.map(toWalletRow);
  }
}
