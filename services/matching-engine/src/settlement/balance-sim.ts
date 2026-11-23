import type { AccountType, LedgerType } from '@gocrypto/shared-types';
import type { BalanceChange, WalletRow } from '@gocrypto/server-core';
import { walletKey } from '@gocrypto/server-core';
import { D, type Decimal, type DecimalLike, ZERO } from '@gocrypto/trading-utils';

/**
 * Tracks balance changes against locked wallet rows so settlement code can ask "what is available
 * right now" (e.g. how much margin is affordable) before the changes are persisted.
 */
export class BalanceSim {
  readonly changes: BalanceChange[] = [];
  private readonly avail = new Map<string, Decimal>();
  private readonly lock = new Map<string, Decimal>();

  constructor(wallets: Map<string, WalletRow>) {
    for (const [k, w] of wallets) {
      this.avail.set(k, w.available);
      this.lock.set(k, w.locked);
    }
  }

  available(userId: string, assetId: number, account: AccountType): Decimal {
    return this.avail.get(walletKey({ userId, assetId, account })) ?? ZERO;
  }

  locked(userId: string, assetId: number, account: AccountType): Decimal {
    return this.lock.get(walletKey({ userId, assetId, account })) ?? ZERO;
  }

  add(
    userId: string,
    assetId: number,
    account: AccountType,
    delta: { available?: DecimalLike; locked?: DecimalLike },
    meta: { type: LedgerType; refType?: string; refId?: string; idemKey?: string; description?: string },
  ): void {
    const a = D(delta.available ?? 0);
    const l = D(delta.locked ?? 0);
    if (a.isZero() && l.isZero()) return;
    const k = walletKey({ userId, assetId, account });
    this.avail.set(k, (this.avail.get(k) ?? ZERO).plus(a));
    this.lock.set(k, (this.lock.get(k) ?? ZERO).plus(l));
    this.changes.push({ userId, assetId, account, available: a, locked: l, ...meta });
  }

  /** locked -> available */
  release(userId: string, assetId: number, account: AccountType, amount: Decimal, meta: { type: LedgerType; refType?: string; refId?: string; idemKey?: string }) {
    if (amount.lte(0)) return;
    this.add(userId, assetId, account, { available: amount, locked: amount.neg() }, meta);
  }

  /** available -> locked */
  reserve(userId: string, assetId: number, account: AccountType, amount: Decimal, meta: { type: LedgerType; refType?: string; refId?: string; idemKey?: string }) {
    if (amount.lte(0)) return;
    this.add(userId, assetId, account, { available: amount.neg(), locked: amount }, meta);
  }
}
