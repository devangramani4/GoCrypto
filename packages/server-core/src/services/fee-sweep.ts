import type { AccountType } from '@gocrypto/shared-types';
import { D, type Decimal, toDb } from '@gocrypto/trading-utils';
import type { Core } from '../core';
import type { Tx } from '../db/database';

export interface FeeAccrual {
  assetId: number;
  account: AccountType;
  amount: Decimal;
  refType: string;
  refId: string | null;
}

/**
 * Append trading-fee revenue for later aggregation (inside the settlement transaction). Unlike crediting
 * the fee collector's wallet directly, this takes no shared row lock, so settlements in different markets
 * never queue behind each other on the fee wallet.
 */
export async function accrueFees(tx: Tx, entries: FeeAccrual[]): Promise<void> {
  const rows = entries.filter((e) => e.amount.gt(0));
  if (!rows.length) return;
  await tx.execute(
    `INSERT INTO fee_accruals (asset_id, account_type, amount, ref_type, ref_id) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
    rows.flatMap((e) => [e.assetId, e.account, toDb(e.amount), e.refType, e.refId]),
  );
}

/**
 * Credit pending fee accruals to the fee collector (one ledger entry per asset/account per sweep) and mark
 * them swept, atomically. Safe to run concurrently (SKIP LOCKED) and idempotent per accrual id range.
 * Returns the number of accruals swept.
 */
export async function sweepFeeAccruals(core: Core, limit = 5000): Promise<number> {
  const feeUser = core.users.systemIds.feeCollector;
  return core.db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string; asset_id: number; account_type: AccountType; amount: string }>(
      'SELECT id, asset_id, account_type, amount FROM fee_accruals WHERE swept_at IS NULL ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED',
      [limit],
    );
    if (!rows.length) return 0;
    const totals = new Map<string, { assetId: number; account: AccountType; amount: Decimal }>();
    for (const r of rows) {
      const k = `${r.asset_id}:${r.account_type}`;
      const t = totals.get(k) ?? { assetId: Number(r.asset_id), account: r.account_type, amount: D(0) };
      t.amount = t.amount.plus(r.amount);
      totals.set(k, t);
    }
    const first = rows[0]!.id;
    const last = rows[rows.length - 1]!.id;
    await core.wallet.apply(
      tx,
      [...totals.values()].map((t) => ({
        userId: feeUser,
        assetId: t.assetId,
        account: t.account,
        available: t.amount,
        type: 'FEE_REVENUE' as const,
        refType: 'FEE_ACCRUALS',
        refId: `${first}-${last}`,
        idemKey: `fee-sweep:${last}:${t.assetId}:${t.account}`,
      })),
    );
    await tx.execute(
      `UPDATE fee_accruals SET swept_at = CURRENT_TIMESTAMP(3) WHERE id IN (${rows.map(() => '?').join(', ')})`,
      rows.map((r) => r.id),
    );
    return rows.length;
  });
}
