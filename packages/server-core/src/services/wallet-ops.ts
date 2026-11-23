import type {
  AccountType,
  AddressBookEntryDto,
  DepositAddressDto,
  DepositDto,
  DepositStatus,
  NotificationType,
  TransferDto,
  WithdrawalDto,
  WithdrawalLimitsDto,
  WithdrawalStatus,
} from '@gocrypto/shared-types';
import { D, type Decimal, ZERO, dmax, toDb, toPlain, validateAddress, validateMemo } from '@gocrypto/trading-utils';
import type { AccountTransferInput, InternalTransferInput, WithdrawInput } from '@gocrypto/validation';
import type { AssetInfo, AssetNetworkInfo } from '../cache/markets';
import type { Core } from '../core';
import { type Executor, parseJson, toMs, toMsStrict } from '../db/database';
import { AppError, isDuplicateKeyError } from '../errors';
import { metrics } from '../metrics';
import { QUEUE_NAMES } from '../queues';
import type { AuthService, RequestContext } from './auth';
import { type CustodyProvider, SandboxCustody } from './custody';
import { scoreWithdrawal } from './withdrawal-risk';

export interface WithdrawalRow {
  id: string;
  user_id: string;
  asset_id: number;
  network_id: number;
  address: string;
  memo: string | null;
  amount: string;
  fee: string;
  amount_usd: string;
  status: WithdrawalStatus;
  risk_score: number;
  risk_flags: unknown;
  idempotency_key: string;
  review_note: string | null;
  tx_hash: string | null;
  created_at: Date;
  completed_at: Date | null;
}

const TERMINAL_WITHDRAWAL: WithdrawalStatus[] = ['COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'];

/** Deposits, withdrawals, transfers and address book. */
export class WalletOpsService {
  readonly custody: CustodyProvider;

  constructor(
    private readonly core: Core,
    private readonly auth: AuthService,
    custody?: CustodyProvider,
  ) {
    this.custody = custody ?? new SandboxCustody();
  }

  // ───────────────────────── deposits ─────────────────────────

  async depositAddress(userId: string, assetSymbol: string, networkCode: string): Promise<DepositAddressDto> {
    const { asset, link } = this.core.assets.requireAssetNetwork(assetSymbol, networkCode);
    if (!link.depositEnabled || !asset.depositEnabled) throw new AppError('DEPOSITS_DISABLED', `${assetSymbol} deposits on ${networkCode} are suspended`);
    const existing = await this.core.db.one<{ address: string; memo: string | null }>(
      'SELECT address, memo FROM deposit_addresses WHERE user_id = ? AND network_id = ?',
      [userId, link.networkId],
    );
    if (existing) return { asset: assetSymbol, network: networkCode, address: existing.address, memo: existing.memo };
    const generated = this.custody.depositAddress(link.network, userId);
    await this.core.db.execute('INSERT IGNORE INTO deposit_addresses (user_id, network_id, address, memo) VALUES (?, ?, ?, ?)', [
      userId,
      link.networkId,
      generated.address,
      generated.memo,
    ]);
    const row = (await this.core.db.one<{ address: string; memo: string | null }>(
      'SELECT address, memo FROM deposit_addresses WHERE user_id = ? AND network_id = ?',
      [userId, link.networkId],
    ))!;
    return { asset: assetSymbol, network: networkCode, address: row.address, memo: row.memo };
  }

  /** Sandbox: simulate an on-chain deposit that confirms over a few seconds. */
  async simulateDeposit(userId: string, input: { asset: string; network: string; amount: string }): Promise<DepositDto> {
    if (!this.core.config.isSandbox) throw new AppError('SANDBOX_ONLY', 'Simulated deposits are only available in sandbox mode');
    const { asset, link } = this.core.assets.requireAssetNetwork(input.asset, input.network);
    if (D(input.amount).lt(link.minDeposit)) throw new AppError('BELOW_MINIMUM', `Minimum deposit is ${link.minDeposit} ${asset.symbol}`);
    const usd = await this.core.prices.toUsd(asset.symbol, input.amount);
    if (usd.gt(this.core.settings.get('sandbox.max_simulated_deposit_usd'))) {
      throw new AppError('VALIDATION_ERROR', 'Simulated deposit exceeds the sandbox limit');
    }
    const addr = await this.depositAddress(userId, asset.symbol, link.network.code);
    const required = Math.min(link.network.confirmations, 3);
    const res = await this.core.db.execute(
      `INSERT INTO deposits (user_id, asset_id, network_id, address, memo, tx_hash, amount, confirmations, required_confirmations, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'CONFIRMING')`,
      [userId, asset.id, link.networkId, addr.address, addr.memo, SandboxCustody.fakeTxHash(link.network), toDb(input.amount), required],
    );
    await this.core.queues.add(QUEUE_NAMES.deposits, 'confirm', { depositId: res.insertId }, { delay: 2000, jobId: `dep-${res.insertId}-1` });
    return (await this.depositById(res.insertId))!;
  }

  /** Ingest an observed on-chain deposit (chain watcher / custody webhook). Idempotent per (network, tx, index). */
  async ingestDeposit(input: { network: string; txHash: string; logIndex?: number; address: string; memo?: string | null; asset: string; amount: string }) {
    const { asset, link } = this.core.assets.requireAssetNetwork(input.asset, input.network);
    const owner = await this.core.db.one<{ user_id: string }>(
      'SELECT user_id FROM deposit_addresses WHERE network_id = ? AND address = ? AND (memo <=> ?)',
      [link.networkId, input.address, input.memo ?? null],
    );
    if (!owner) throw new AppError('NOT_FOUND', 'Unknown deposit address');
    try {
      const res = await this.core.db.execute(
        `INSERT INTO deposits (user_id, asset_id, network_id, address, memo, tx_hash, log_index, amount, required_confirmations, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [owner.user_id, asset.id, link.networkId, input.address, input.memo ?? null, input.txHash, input.logIndex ?? 0, toDb(input.amount), link.network.confirmations],
      );
      return res.insertId;
    } catch (e) {
      if (isDuplicateKeyError(e, 'uq_deposit_tx')) return null;
      throw e;
    }
  }

  /** Record new confirmations; credits the deposit exactly once when the threshold is reached. */
  async confirmDeposit(depositId: string, confirmations?: number): Promise<{ status: DepositStatus; credited: boolean }> {
    const result = await this.core.db.transaction(async (tx) => {
      const dep = await tx.one<{
        id: string;
        user_id: string;
        asset_id: number;
        amount: string;
        confirmations: number;
        required_confirmations: number;
        status: DepositStatus;
      }>('SELECT * FROM deposits WHERE id = ? FOR UPDATE', [depositId]);
      if (!dep) throw new AppError('NOT_FOUND', 'Deposit not found');
      if (dep.status === 'COMPLETED' || dep.status === 'FAILED') return { status: dep.status, credited: false, dep };
      const next = confirmations ?? Number(dep.confirmations) + 1;
      if (next < Number(dep.required_confirmations)) {
        await tx.execute("UPDATE deposits SET confirmations = ?, status = 'CONFIRMING' WHERE id = ?", [next, depositId]);
        return { status: 'CONFIRMING' as DepositStatus, credited: false, dep };
      }
      await this.core.wallet.apply(tx, [
        {
          userId: String(dep.user_id),
          assetId: Number(dep.asset_id),
          account: 'SPOT',
          available: dep.amount,
          type: 'DEPOSIT',
          refType: 'DEPOSIT',
          refId: String(dep.id),
          idemKey: `dep:${dep.id}`,
        },
      ]);
      await tx.execute("UPDATE deposits SET confirmations = ?, status = 'COMPLETED', credited_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [next, depositId]);
      return { status: 'COMPLETED' as DepositStatus, credited: true, dep };
    });
    if (result.credited) {
      metrics.depositsTotal.inc();
      const asset = this.core.assets.symbolOf(Number(result.dep.asset_id));
      await this.core.notifications.notify({
        userId: String(result.dep.user_id),
        type: 'DEPOSIT_RECEIVED',
        title: 'Deposit received',
        body: `${toPlain(result.dep.amount)} ${asset} has been credited to your spot wallet.`,
        data: { depositId: String(result.dep.id), asset },
      });
    }
    return { status: result.status, credited: result.credited };
  }

  /** Maps a `deposits` row (also used by admin listings to avoid per-row lookups). */
  depositDto(r: Record<string, unknown>): DepositDto {
    return {
      id: String(r.id),
      asset: this.core.assets.symbolOf(Number(r.asset_id)),
      network: this.core.assets.networkById(Number(r.network_id))?.code ?? '',
      address: String(r.address),
      memo: (r.memo as string | null) ?? null,
      txHash: String(r.tx_hash),
      amount: toPlain(String(r.amount)),
      confirmations: Number(r.confirmations),
      requiredConfirmations: Number(r.required_confirmations),
      status: r.status as DepositStatus,
      createdAt: toMsStrict(r.created_at),
      creditedAt: toMs(r.credited_at),
    };
  }

  async depositById(id: string): Promise<DepositDto | null> {
    const r = await this.core.db.one<Record<string, unknown>>('SELECT * FROM deposits WHERE id = ?', [id]);
    return r ? this.depositDto(r) : null;
  }

  async deposits(userId: string, limit = 50, cursor?: string) {
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT * FROM deposits WHERE user_id = ? ${cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      cursor ? [userId, cursor, limit + 1] : [userId, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: page.map((r) => this.depositDto(r)), nextCursor: rows.length > limit ? String(page[page.length - 1]!.id) : null };
  }

  // ───────────────────────── withdrawals ─────────────────────────

  /** Maps a `withdrawals` row (also used by admin listings to avoid per-row lookups). */
  withdrawalDto(r: WithdrawalRow): WithdrawalDto {
    return {
      id: String(r.id),
      asset: this.core.assets.symbolOf(Number(r.asset_id)),
      network: this.core.assets.networkById(Number(r.network_id))?.code ?? '',
      address: r.address,
      memo: r.memo,
      amount: toPlain(r.amount),
      fee: toPlain(r.fee),
      receiveAmount: toPlain(D(r.amount).minus(r.fee)),
      status: r.status,
      txHash: r.tx_hash,
      riskFlags: parseJson<string[]>(r.risk_flags, []),
      reviewNote: r.review_note,
      createdAt: toMsStrict(r.created_at),
      completedAt: toMs(r.completed_at),
    };
  }

  async withdrawalById(id: string, exec: Executor = this.core.db): Promise<WithdrawalDto | null> {
    const r = await exec.one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', [id]);
    return r ? this.withdrawalDto(r) : null;
  }

  async withdrawals(userId: string, limit = 50, cursor?: string) {
    const rows = await this.core.db.query<WithdrawalRow>(
      `SELECT * FROM withdrawals WHERE user_id = ? ${cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      cursor ? [userId, cursor, limit + 1] : [userId, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: page.map((r) => this.withdrawalDto(r)), nextCursor: rows.length > limit ? String(page[page.length - 1]!.id) : null };
  }

  private async usedTodayUsd(userId: string): Promise<Decimal> {
    const r = await this.core.db.one<{ s: string | null }>(
      `SELECT SUM(amount_usd) AS s FROM withdrawals WHERE user_id = ? AND created_at >= (CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY)
         AND status NOT IN ('REJECTED','CANCELLED','FAILED')`,
      [userId],
    );
    return D(r?.s ?? 0);
  }

  private dailyLimitUsd(kycLevel: number): Decimal {
    const limits = this.core.settings.get('withdrawal.daily_limit_usd') as Record<string, string>;
    return D(limits[String(kycLevel)] ?? limits['0'] ?? '0');
  }

  async withdrawalLimits(userId: string, assetSymbol: string, networkCode: string): Promise<WithdrawalLimitsDto> {
    const { asset, link } = this.core.assets.requireAssetNetwork(assetSymbol, networkCode);
    const flags = await this.core.users.flags(userId);
    const sec = await this.auth.security(userId);
    const wallet = await this.core.wallet.getWallet(this.core.db, { userId, assetId: asset.id, account: 'SPOT' });
    const limit = this.dailyLimitUsd(flags.kycLevel);
    const used = await this.usedTodayUsd(userId);
    return {
      asset: asset.symbol,
      network: networkCode,
      fee: link.withdrawalFee,
      minAmount: link.minWithdrawal,
      available: toPlain(wallet?.available ?? ZERO),
      dailyLimitUsd: toPlain(limit),
      usedTodayUsd: toPlain(used.toDecimalPlaces(2)),
      remainingTodayUsd: toPlain(dmax(ZERO, limit.minus(used)).toDecimalPlaces(2)),
      requires: { pin: true, totp: Boolean(sec.totp_enabled), emailCode: Boolean(this.core.settings.get('withdrawal.require_email_code')) },
    };
  }

  async sendWithdrawalCode(userId: string, input: { asset: string; amount: string; address: string }): Promise<void> {
    const user = await this.core.users.requireById(userId);
    const sec = await this.auth.security(userId);
    const code = await this.auth.otp.issue('withdrawal', userId, { ttlSec: 600 });
    await this.core.queues.email({
      to: user.email,
      subject: 'Confirm your GoCrypto withdrawal',
      template: 'withdrawal_code',
      vars: { code, asset: input.asset, amount: input.amount, address: input.address },
      antiPhishingCode: sec.anti_phishing_code,
    });
  }

  private validateDestination(link: AssetNetworkInfo, address: string, memo: string | null | undefined): { address: string; memo: string | null } {
    const v = validateAddress(link.network.addressFormat, address, { testnet: false });
    if (!v.valid) throw new AppError('INVALID_ADDRESS', v.reason ?? 'Invalid address');
    if (memo && !link.network.memoSupported) throw new AppError('INVALID_MEMO', `${link.network.code} does not support memos`);
    const m = validateMemo(link.network.addressFormat, memo);
    if (!m.valid) throw new AppError('INVALID_MEMO', m.reason ?? 'Invalid memo');
    return { address: v.normalized ?? address, memo: memo || null };
  }

  validateAddressFor(networkCode: string, address: string, memo?: string | null): { valid: boolean; reason?: string; normalized?: string } {
    const network = this.core.assets.network(networkCode);
    if (!network) throw new AppError('NETWORK_NOT_FOUND', 'Unknown network');
    const v = validateAddress(network.addressFormat, address);
    if (!v.valid) return v;
    const m = validateMemo(network.addressFormat, memo);
    return m.valid ? v : { valid: false, reason: m.reason };
  }

  /**
   * Withdrawal request: account checks -> address validation -> PIN / 2FA / email code -> daily
   * limit -> risk scoring -> funds locked atomically -> auto-approved or held for manual review.
   */
  async requestWithdrawal(userId: string, input: WithdrawInput, ctx: RequestContext): Promise<WithdrawalDto> {
    const existing = await this.core.db.one<WithdrawalRow>('SELECT * FROM withdrawals WHERE user_id = ? AND idempotency_key = ?', [
      userId,
      input.idempotencyKey,
    ]);
    if (existing) return this.withdrawalDto(existing);

    const flags = await this.core.users.assertCanWithdraw(userId);
    const { asset, link } = this.core.assets.requireAssetNetwork(input.asset, input.network);
    if (!asset.withdrawEnabled || !link.withdrawEnabled) {
      throw new AppError('WITHDRAWALS_DISABLED', `${asset.symbol} withdrawals on ${link.network.code} are suspended`);
    }
    const dest = this.validateDestination(link, input.address, input.memo);
    const own = await this.core.db.one<{ user_id: string }>('SELECT user_id FROM deposit_addresses WHERE address = ? AND (memo <=> ?)', [
      dest.address,
      dest.memo,
    ]);
    if (own) throw new AppError('INVALID_ADDRESS', 'This is a GoCrypto deposit address; use an internal transfer instead');
    const amount = D(input.amount);
    if (amount.decimalPlaces() > link.withdrawalPrecision) throw new AppError('VALIDATION_ERROR', `Maximum ${link.withdrawalPrecision} decimal places`);
    if (amount.lt(link.minWithdrawal)) throw new AppError('BELOW_MINIMUM', `Minimum withdrawal is ${link.minWithdrawal} ${asset.symbol}`);
    const fee = D(link.withdrawalFee);
    if (amount.lte(fee)) throw new AppError('BELOW_MINIMUM', 'Amount must exceed the network fee');

    const sec = await this.auth.security(userId);
    if (sec.withdrawal_lock_until && sec.withdrawal_lock_until.getTime() > Date.now()) {
      throw new AppError('WITHDRAWAL_LOCKED', 'Withdrawals are temporarily locked after a security change', {
        details: { until: sec.withdrawal_lock_until.getTime() },
      });
    }
    if (!sec.trading_pin_hash) throw new AppError('PIN_NOT_SET', 'Set a withdrawal PIN before withdrawing');
    if (!input.pin) throw new AppError('PIN_REQUIRED', 'Withdrawal PIN required');
    await this.auth.verifyPin(userId, input.pin);
    if (sec.totp_enabled) {
      if (!input.totpCode) throw new AppError('MFA_REQUIRED', '2FA code required');
      await this.auth.verifyTotpFor(userId, input.totpCode);
    }
    if (this.core.settings.get('withdrawal.require_email_code')) {
      if (!input.emailCode) throw new AppError('INVALID_OTP', 'Email confirmation code required');
      await this.auth.otp.verify('withdrawal', userId, input.emailCode);
    }

    const amountUsd = await this.core.prices.toUsd(asset.symbol, amount);
    const limit = this.dailyLimitUsd(flags.kycLevel);
    const used = await this.usedTodayUsd(userId);
    if (used.plus(amountUsd).gt(limit)) {
      throw new AppError('WITHDRAWAL_LIMIT_EXCEEDED', `Daily withdrawal limit of ${limit.toFixed(0)} USD exceeded`, {
        details: { limitUsd: limit.toFixed(2), usedUsd: used.toFixed(2) },
      });
    }

    const usedBefore = await this.core.db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ? AND address = ? AND status = 'COMPLETED'",
      [userId, dest.address],
    );
    const inBook = await this.core.db.one<{ c: number }>(
      'SELECT COUNT(*) AS c FROM withdrawal_addresses WHERE user_id = ? AND address = ? AND deleted_at IS NULL',
      [userId, dest.address],
    );
    const recent = await this.core.db.one<{ c: number }>(
      'SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ? AND created_at >= (CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY)',
      [userId],
    );
    const user = await this.core.users.requireById(userId);
    const balances = await this.core.wallet.balances(userId);
    const balanceUsd = balances.reduce((acc, b) => acc.plus(b.usdValue), ZERO);
    const risk = scoreWithdrawal({
      amountUsd,
      reviewThresholdUsd: D(this.core.settings.get('withdrawal.review_threshold_usd')),
      newAddress: Number(usedBefore?.c ?? 0) === 0 && Number(inBook?.c ?? 0) === 0,
      newAddressReview: Boolean(this.core.settings.get('withdrawal.new_address_review')),
      accountAgeDays: (Date.now() - user.created_at.getTime()) / 86_400_000,
      twoFactorEnabled: Boolean(sec.totp_enabled),
      balanceUsd,
      withdrawalsLast24h: Number(recent?.c ?? 0),
      kycLevel: flags.kycLevel,
    });
    const status: WithdrawalStatus = risk.requiresReview ? 'PENDING_REVIEW' : 'APPROVED';

    let withdrawalId: string;
    try {
      withdrawalId = await this.core.db.transaction(async (tx) => {
        const res = await tx.execute(
          `INSERT INTO withdrawals (user_id, asset_id, network_id, address, memo, amount, fee, amount_usd, status, risk_score, risk_flags, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, asset.id, link.networkId, dest.address, dest.memo, toDb(amount), toDb(fee), toDb(amountUsd), status, risk.score, JSON.stringify(risk.flags), input.idempotencyKey],
        );
        await this.core.wallet.apply(tx, [
          {
            userId,
            assetId: asset.id,
            account: 'SPOT',
            available: amount.neg(),
            locked: amount,
            type: 'WITHDRAWAL_LOCK',
            refType: 'WITHDRAWAL',
            refId: res.insertId,
            idemKey: `wd:${res.insertId}:lock`,
          },
        ]);
        if (input.saveToAddressBook && Number(inBook?.c ?? 0) === 0) {
          await tx.execute('INSERT INTO withdrawal_addresses (user_id, network_id, address, memo, label) VALUES (?, ?, ?, ?, ?)', [
            userId,
            link.networkId,
            dest.address,
            dest.memo,
            input.label ?? `${asset.symbol} ${link.network.code}`,
          ]);
        }
        await this.core.audit.log(
          {
            actorUserId: userId,
            actorType: 'USER',
            action: 'wallet.withdrawal_requested',
            targetType: 'WITHDRAWAL',
            targetId: res.insertId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { asset: asset.symbol, amount: amount.toFixed(), risk },
          },
          tx,
        );
        return res.insertId;
      });
    } catch (e) {
      if (isDuplicateKeyError(e, 'uq_withdrawal_idem')) {
        const again = await this.core.db.one<WithdrawalRow>('SELECT * FROM withdrawals WHERE user_id = ? AND idempotency_key = ?', [userId, input.idempotencyKey]);
        if (again) return this.withdrawalDto(again);
      }
      throw e;
    }
    if (risk.requiresReview) {
      await this.auth.alert(userId, 'WITHDRAWAL_RISK', risk.score >= 70 ? 'HIGH' : 'MEDIUM', ctx.ip, { withdrawalId, ...risk });
    } else {
      await this.core.queues.add(QUEUE_NAMES.withdrawals, 'process', { withdrawalId }, { jobId: `wd-${withdrawalId}` });
    }
    await this.core.notifications.notify({
      userId,
      type: 'WITHDRAWAL_REQUESTED',
      title: 'Withdrawal requested',
      body: `${amount.toFixed()} ${asset.symbol} to ${dest.address.slice(0, 10)}… ${risk.requiresReview ? 'is pending review.' : 'is being processed.'}`,
      data: { withdrawalId },
    });
    return (await this.withdrawalById(withdrawalId))!;
  }

  async cancelWithdrawal(userId: string, id: string): Promise<WithdrawalDto> {
    await this.finishWithdrawal(id, 'CANCELLED', { expect: ['PENDING_REVIEW', 'APPROVED'], userId });
    return (await this.withdrawalById(id))!;
  }

  async reviewWithdrawal(adminId: string, id: string, decision: 'APPROVE' | 'REJECT', note?: string): Promise<WithdrawalDto> {
    if (decision === 'APPROVE') {
      const res = await this.core.db.execute(
        "UPDATE withdrawals SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_note = ? WHERE id = ? AND status = 'PENDING_REVIEW'",
        [adminId, note ?? null, id],
      );
      if (res.affectedRows !== 1) throw new AppError('CONFLICT', 'Withdrawal is not pending review');
      await this.core.queues.add(QUEUE_NAMES.withdrawals, 'process', { withdrawalId: id }, { jobId: `wd-${id}` });
    } else {
      await this.finishWithdrawal(id, 'REJECTED', { expect: ['PENDING_REVIEW', 'APPROVED'], note, reviewer: adminId });
    }
    await this.core.audit.log({ actorUserId: adminId, actorType: 'ADMIN', action: `admin.withdrawal.${decision.toLowerCase()}`, targetType: 'WITHDRAWAL', targetId: id, metadata: { note } });
    return (await this.withdrawalById(id))!;
  }

  /** Worker step: APPROVED -> PROCESSING -> broadcast -> COMPLETED (or FAILED with funds returned). */
  async processWithdrawal(id: string): Promise<WithdrawalStatus> {
    const claimed = await this.core.db.execute("UPDATE withdrawals SET status = 'PROCESSING' WHERE id = ? AND status = 'APPROVED'", [id]);
    if (claimed.affectedRows !== 1) {
      const row = await this.core.db.one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', [id]);
      return row?.status ?? 'FAILED';
    }
    const row = (await this.core.db.one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', [id]))!;
    const network = this.core.assets.networkById(Number(row.network_id))!;
    try {
      const { txHash } = await this.custody.broadcastWithdrawal({
        network,
        asset: this.core.assets.symbolOf(Number(row.asset_id)),
        address: row.address,
        memo: row.memo,
        amount: D(row.amount).minus(row.fee).toFixed(),
      });
      await this.finishWithdrawal(id, 'COMPLETED', { expect: ['PROCESSING'], txHash });
      return 'COMPLETED';
    } catch (e) {
      this.core.log.error({ err: e, withdrawalId: id }, 'withdrawal broadcast failed');
      await this.finishWithdrawal(id, 'FAILED', { expect: ['PROCESSING'], note: 'Broadcast failed' });
      return 'FAILED';
    }
  }

  /** Terminal transition with exactly-once balance effects. */
  private async finishWithdrawal(
    id: string,
    status: 'COMPLETED' | 'FAILED' | 'REJECTED' | 'CANCELLED',
    opts: { expect: WithdrawalStatus[]; userId?: string; txHash?: string; note?: string; reviewer?: string },
  ): Promise<void> {
    const row = await this.core.db.transaction(async (tx) => {
      const w = await tx.one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ? FOR UPDATE', [id]);
      if (!w || (opts.userId && String(w.user_id) !== opts.userId)) throw new AppError('NOT_FOUND', 'Withdrawal not found');
      if (!opts.expect.includes(w.status)) {
        throw new AppError(status === 'CANCELLED' ? 'WITHDRAWAL_NOT_CANCELLABLE' : 'CONFLICT', `Withdrawal is ${w.status.toLowerCase()}`);
      }
      const amount = D(w.amount);
      const fee = D(w.fee);
      const userId = String(w.user_id);
      const assetId = Number(w.asset_id);
      if (status === 'COMPLETED') {
        await this.core.wallet.apply(tx, [
          { userId, assetId, account: 'SPOT', locked: amount.neg(), type: 'WITHDRAWAL', refType: 'WITHDRAWAL', refId: id, idemKey: `wd:${id}:done` },
          ...(fee.gt(0)
            ? [
                {
                  userId: this.core.users.systemIds.feeCollector,
                  assetId,
                  account: 'SPOT' as AccountType,
                  available: fee,
                  type: 'FEE_REVENUE' as const,
                  refType: 'WITHDRAWAL',
                  refId: id,
                  idemKey: `wd:${id}:fee`,
                },
              ]
            : []),
        ]);
      } else {
        await this.core.wallet.apply(tx, [
          { userId, assetId, account: 'SPOT', available: amount, locked: amount.neg(), type: 'WITHDRAWAL_UNLOCK', refType: 'WITHDRAWAL', refId: id, idemKey: `wd:${id}:unlock` },
        ]);
      }
      await tx.execute(
        `UPDATE withdrawals SET status = ?, tx_hash = COALESCE(?, tx_hash), review_note = COALESCE(?, review_note),
           reviewed_by = COALESCE(?, reviewed_by), reviewed_at = IF(? IS NULL, reviewed_at, CURRENT_TIMESTAMP(3)),
           completed_at = IF(? = 'COMPLETED', CURRENT_TIMESTAMP(3), completed_at), failure_reason = ?
         WHERE id = ?`,
        [status, opts.txHash ?? null, opts.note ?? null, opts.reviewer ?? null, opts.reviewer ?? null, status, status === 'FAILED' ? (opts.note ?? 'failed') : null, id],
      );
      return w;
    });
    metrics.withdrawalsTotal.inc({ status });
    const asset = this.core.assets.symbolOf(Number(row.asset_id));
    const messages: Record<typeof status, [NotificationType, string, string]> = {
      COMPLETED: ['WITHDRAWAL_PROCESSED', 'Withdrawal completed', `${toPlain(D(row.amount).minus(row.fee))} ${asset} was sent.`],
      FAILED: ['WITHDRAWAL_REJECTED', 'Withdrawal failed', `Your ${asset} withdrawal failed; funds were returned to your wallet.`],
      REJECTED: ['WITHDRAWAL_REJECTED', 'Withdrawal rejected', `Your ${asset} withdrawal was rejected after review; funds were returned.`],
      CANCELLED: ['WITHDRAWAL_REJECTED', 'Withdrawal cancelled', `Your ${asset} withdrawal was cancelled; funds were returned.`],
    };
    const [type, title, body] = messages[status];
    await this.core.notifications.notify({ userId: String(row.user_id), type, title, body, data: { withdrawalId: id } });
  }

  isTerminal(status: WithdrawalStatus): boolean {
    return TERMINAL_WITHDRAWAL.includes(status);
  }

  // ───────────────────────── transfers ─────────────────────────

  /** Move funds between the user's own accounts (spot / futures / options). */
  async accountTransfer(userId: string, input: AccountTransferInput): Promise<TransferDto> {
    await this.core.users.assertCanWithdraw(userId).catch((e: AppError) => {
      if (e.code === 'EMAIL_NOT_VERIFIED' || e.code === 'WITHDRAWALS_DISABLED') return;
      throw e;
    });
    const asset = this.core.assets.require(input.asset);
    if ((input.from !== 'SPOT' || input.to !== 'SPOT') && asset.symbol !== 'USDT') {
      throw new AppError('VALIDATION_ERROR', 'Only USDT can be transferred to or from derivatives accounts');
    }
    const amount = D(input.amount);
    if (amount.decimalPlaces() > asset.decimals) throw new AppError('VALIDATION_ERROR', `Maximum ${asset.decimals} decimal places`);
    if (input.idempotencyKey) {
      const dup = await this.core.db.one<Record<string, unknown>>('SELECT * FROM transfers WHERE from_user_id = ? AND idempotency_key = ?', [userId, input.idempotencyKey]);
      if (dup) return this.transferDto(dup, userId);
    }
    const marks = input.from === 'FUTURES' ? await this.core.futures.markPrices(this.core.markets.list('FUTURES')) : null;
    await this.core.wallet.ensureWallets(this.core.db, [
      { userId, assetId: asset.id, account: input.from },
      { userId, assetId: asset.id, account: input.to },
    ]);
    const id = await this.core.db.transaction(async (tx) => {
      const wallets = await this.core.wallet.lockWallets(tx, [
        { userId, assetId: asset.id, account: input.from },
        { userId, assetId: asset.id, account: input.to },
      ]);
      const src = wallets.get(`${userId}:${input.from}:${asset.id}`)!;
      let max = src.available;
      if (input.from === 'FUTURES' && marks) {
        const positions = await this.core.futures.positionsOf(userId, tx);
        const { evaluateAccount } = await import('./futures');
        const acct = evaluateAccount(
          { available: src.available, locked: src.locked },
          positions.map((pos) => ({ pos, market: this.core.markets.requireId(pos.marketId), mark: marks.get(pos.marketId) ?? pos.entry })),
          ZERO,
        );
        max = this.core.futures.maxWithdrawable(acct);
      }
      if (amount.gt(max)) throw new AppError('INSUFFICIENT_BALANCE', `Maximum transferable is ${toPlain(max.toDecimalPlaces(8))} ${asset.symbol}`);
      const res = await tx.execute(
        `INSERT INTO transfers (type, from_user_id, to_user_id, asset_id, amount, from_account, to_account, idempotency_key)
         VALUES ('ACCOUNT', ?, ?, ?, ?, ?, ?, ?)`,
        [userId, userId, asset.id, toDb(amount), input.from, input.to, input.idempotencyKey ?? null],
      );
      await this.core.wallet.apply(
        tx,
        [
          { userId, assetId: asset.id, account: input.from, available: amount.neg(), type: 'TRANSFER_OUT', refType: 'TRANSFER', refId: res.insertId, idemKey: `tr:${res.insertId}:out` },
          { userId, assetId: asset.id, account: input.to, available: amount, type: 'TRANSFER_IN', refType: 'TRANSFER', refId: res.insertId, idemKey: `tr:${res.insertId}:in` },
        ],
        wallets,
      );
      return res.insertId;
    });
    const row = (await this.core.db.one<Record<string, unknown>>('SELECT * FROM transfers WHERE id = ?', [id]))!;
    return this.transferDto(row, userId);
  }

  /** Off-chain transfer to another GoCrypto user (instant, no network fee). */
  async internalTransfer(userId: string, input: InternalTransferInput, ctx: RequestContext): Promise<TransferDto> {
    const dup = await this.core.db.one<Record<string, unknown>>('SELECT * FROM transfers WHERE from_user_id = ? AND idempotency_key = ?', [
      userId,
      input.idempotencyKey,
    ]);
    if (dup) return this.transferDto(dup, userId);
    await this.core.users.assertCanWithdraw(userId);
    const asset: AssetInfo = this.core.assets.require(input.asset);
    const recipient = input.recipient.includes('@') ? await this.core.users.findByEmail(input.recipient) : await this.core.users.findByUid(input.recipient);
    if (!recipient || recipient.is_system || recipient.status === 'DISABLED') throw new AppError('RECIPIENT_NOT_FOUND', 'Recipient not found');
    if (String(recipient.id) === userId) throw new AppError('SELF_TRANSFER', 'Use an account transfer to move funds between your own accounts');
    const sec = await this.auth.security(userId);
    if (sec.withdrawal_lock_until && sec.withdrawal_lock_until.getTime() > Date.now()) {
      throw new AppError('WITHDRAWAL_LOCKED', 'Transfers are temporarily locked after a security change');
    }
    if (!sec.trading_pin_hash) throw new AppError('PIN_NOT_SET', 'Set a PIN before sending transfers');
    if (!input.pin) throw new AppError('PIN_REQUIRED', 'PIN required');
    await this.auth.verifyPin(userId, input.pin);
    if (sec.totp_enabled) {
      if (!input.totpCode) throw new AppError('MFA_REQUIRED', '2FA code required');
      await this.auth.verifyTotpFor(userId, input.totpCode);
    }
    const amount = D(input.amount);
    if (amount.decimalPlaces() > asset.decimals) throw new AppError('VALIDATION_ERROR', `Maximum ${asset.decimals} decimal places`);
    const flags = await this.core.users.flags(userId);
    const usd = await this.core.prices.toUsd(asset.symbol, amount);
    const used = await this.usedTodayUsd(userId);
    if (used.plus(usd).gt(this.dailyLimitUsd(flags.kycLevel))) throw new AppError('WITHDRAWAL_LIMIT_EXCEEDED', 'Daily transfer limit exceeded');
    const to = String(recipient.id);
    await this.core.wallet.ensureWallets(this.core.db, [
      { userId, assetId: asset.id, account: 'SPOT' },
      { userId: to, assetId: asset.id, account: 'SPOT' },
    ]);
    let id: string;
    try {
      id = await this.core.db.transaction(async (tx) => {
        const res = await tx.execute(
          `INSERT INTO transfers (type, from_user_id, to_user_id, asset_id, amount, from_account, to_account, note, idempotency_key)
           VALUES ('USER', ?, ?, ?, ?, 'SPOT', 'SPOT', ?, ?)`,
          [userId, to, asset.id, toDb(amount), input.note ?? null, input.idempotencyKey],
        );
        await this.core.wallet.apply(tx, [
          { userId, assetId: asset.id, account: 'SPOT', available: amount.neg(), type: 'TRANSFER_OUT', refType: 'TRANSFER', refId: res.insertId, idemKey: `tr:${res.insertId}:out` },
          { userId: to, assetId: asset.id, account: 'SPOT', available: amount, type: 'TRANSFER_IN', refType: 'TRANSFER', refId: res.insertId, idemKey: `tr:${res.insertId}:in` },
        ]);
        await this.core.audit.log(
          { actorUserId: userId, actorType: 'USER', action: 'wallet.internal_transfer', targetType: 'USER', targetId: to, ip: ctx.ip, metadata: { asset: asset.symbol, amount: amount.toFixed() } },
          tx,
        );
        return res.insertId;
      });
    } catch (e) {
      if (isDuplicateKeyError(e, 'uq_transfer_idem')) {
        const again = await this.core.db.one<Record<string, unknown>>('SELECT * FROM transfers WHERE from_user_id = ? AND idempotency_key = ?', [userId, input.idempotencyKey]);
        if (again) return this.transferDto(again, userId);
      }
      throw e;
    }
    await this.core.notifications.notify({
      userId: to,
      type: 'TRANSFER_RECEIVED',
      title: 'Transfer received',
      body: `You received ${amount.toFixed()} ${asset.symbol} from another GoCrypto user.`,
      data: { transferId: id },
    });
    const row = (await this.core.db.one<Record<string, unknown>>('SELECT * FROM transfers WHERE id = ?', [id]))!;
    return this.transferDto(row, userId);
  }

  private transferDto(r: Record<string, unknown>, viewer: string): TransferDto {
    const type = r.type as 'ACCOUNT' | 'USER';
    const incoming = String(r.to_user_id) === viewer && String(r.from_user_id) !== viewer;
    return {
      id: String(r.id),
      asset: this.core.assets.symbolOf(Number(r.asset_id)),
      amount: toPlain(String(r.amount)),
      type,
      fromAccount: r.from_account as AccountType,
      toAccount: r.to_account as AccountType,
      direction: type === 'ACCOUNT' ? 'INTERNAL' : incoming ? 'IN' : 'OUT',
      counterparty: type === 'USER' ? `UID ${incoming ? String(r.from_user_id) : String(r.to_user_id)}` : null,
      createdAt: toMsStrict(r.created_at),
    };
  }

  async transfers(userId: string, limit = 50, cursor?: string) {
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT * FROM transfers WHERE (from_user_id = ? OR to_user_id = ?) ${cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      cursor ? [userId, userId, cursor, limit + 1] : [userId, userId, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: page.map((r) => this.transferDto(r, userId)), nextCursor: rows.length > limit ? String(page[page.length - 1]!.id) : null };
  }

  // ───────────────────────── address book ─────────────────────────

  async addressBook(userId: string): Promise<AddressBookEntryDto[]> {
    const rows = await this.core.db.query<Record<string, unknown>>(
      'SELECT * FROM withdrawal_addresses WHERE user_id = ? AND deleted_at IS NULL ORDER BY id DESC',
      [userId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      network: this.core.assets.networkById(Number(r.network_id))?.code ?? '',
      address: String(r.address),
      memo: (r.memo as string | null) ?? null,
      label: String(r.label),
      createdAt: toMsStrict(r.created_at),
    }));
  }

  async addAddress(userId: string, input: { network: string; address: string; memo?: string | null; label: string }): Promise<AddressBookEntryDto> {
    const network = this.core.assets.network(input.network);
    if (!network) throw new AppError('NETWORK_NOT_FOUND', 'Unknown network');
    const v = this.validateAddressFor(input.network, input.address, input.memo);
    if (!v.valid) throw new AppError('INVALID_ADDRESS', v.reason ?? 'Invalid address');
    const res = await this.core.db.execute('INSERT INTO withdrawal_addresses (user_id, network_id, address, memo, label) VALUES (?, ?, ?, ?, ?)', [
      userId,
      network.id,
      v.normalized ?? input.address,
      input.memo ?? null,
      input.label,
    ]);
    return (await this.addressBook(userId)).find((a) => a.id === res.insertId)!;
  }

  async removeAddress(userId: string, id: string): Promise<void> {
    const res = await this.core.db.execute('UPDATE withdrawal_addresses SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId]);
    if (res.affectedRows === 0) throw new AppError('NOT_FOUND', 'Address not found');
  }
}
