import type { Permission, UserDto, UserRole, UserStatus } from '@gocrypto/shared-types';
import type { Core } from '../core';
import { type Executor, toMs, toMsStrict } from '../db/database';
import { AppError } from '../errors';
import { TtlCache } from '../cache/ttl-cache';

export interface UserRow {
  id: string;
  uid: string;
  email: string;
  email_verified_at: Date | null;
  phone: string | null;
  phone_verified_at: Date | null;
  password_hash: string | null;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  status_reason: string | null;
  trading_enabled: boolean;
  withdrawals_enabled: boolean;
  kyc_level: number;
  vip_tier: number;
  is_system: boolean;
  locale: string;
  last_login_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface UserFlags {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  tradingEnabled: boolean;
  withdrawalsEnabled: boolean;
  vipTier: number;
  kycLevel: number;
  isSystem: boolean;
  emailVerified: boolean;
}

export const SYSTEM_EMAILS = {
  marketMaker: 'marketmaker@system.gocrypto',
  feeCollector: 'fees@system.gocrypto',
  insuranceFund: 'insurance@system.gocrypto',
  /** Sandbox taker-flow simulator (separate from the market maker to avoid self-trades). */
  flowTrader: 'flow@system.gocrypto',
} as const;

export class UserService {
  /** Bounded: at most 100k users per process, 5s freshness (status changes also invalidate explicitly). */
  private flagsCache = new TtlCache<string, UserFlags>(100_000, 5_000);
  private rolePermissions = new Map<string, Permission[]>();
  private systemIdSet = new Set<string>();
  systemIds: { marketMaker: string; feeCollector: string; insuranceFund: string } = {
    marketMaker: '0',
    feeCollector: '0',
    insuranceFund: '0',
  };

  constructor(private readonly core: Core) {}

  async load(): Promise<void> {
    const sys = await this.core.db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE is_system = 1',
    );
    this.systemIdSet = new Set(sys.map((r) => String(r.id)));
    const byEmail = new Map(sys.map((r) => [r.email, String(r.id)]));
    this.systemIds = {
      marketMaker: byEmail.get(SYSTEM_EMAILS.marketMaker) ?? '0',
      feeCollector: byEmail.get(SYSTEM_EMAILS.feeCollector) ?? '0',
      insuranceFund: byEmail.get(SYSTEM_EMAILS.insuranceFund) ?? '0',
    };
    await this.loadRoles();
  }

  async loadRoles(): Promise<void> {
    const rows = await this.core.db.query<{ role_code: string; permission_code: Permission }>(
      'SELECT role_code, permission_code FROM role_permissions',
    );
    const map = new Map<string, Permission[]>();
    for (const r of rows) map.set(r.role_code, [...(map.get(r.role_code) ?? []), r.permission_code]);
    this.rolePermissions = map;
  }

  permissionsFor(role: UserRole): Permission[] {
    return this.rolePermissions.get(role) ?? [];
  }

  hasPermission(role: UserRole, permission: Permission): boolean {
    return this.permissionsFor(role).includes(permission);
  }

  isSystemUserCached(userId: string): boolean {
    return this.systemIdSet.has(userId);
  }

  invalidate(userId: string): void {
    this.flagsCache.delete(userId);
  }

  /** Hot-path user flags (status, trading permissions, fee tier) cached for 5 seconds. */
  async flags(userId: string): Promise<UserFlags> {
    const cached = this.flagsCache.get(userId);
    if (cached) return cached;
    const row = await this.core.db.one<UserRow>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [userId]);
    if (!row) throw new AppError('UNAUTHORIZED', 'User not found');
    const flags = this.toFlags(row);
    this.flagsCache.set(userId, flags);
    return flags;
  }

  toFlags(row: UserRow): UserFlags {
    return {
      id: String(row.id),
      email: row.email,
      role: row.role,
      status: row.status,
      tradingEnabled: Boolean(row.trading_enabled),
      withdrawalsEnabled: Boolean(row.withdrawals_enabled),
      vipTier: Number(row.vip_tier),
      kycLevel: Number(row.kyc_level),
      isSystem: Boolean(row.is_system),
      emailVerified: row.email_verified_at != null,
    };
  }

  async findById(id: string, exec: Executor = this.core.db): Promise<UserRow | null> {
    return exec.one<UserRow>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  async requireById(id: string, exec: Executor = this.core.db): Promise<UserRow> {
    const u = await this.findById(id, exec);
    if (!u) throw new AppError('NOT_FOUND', 'User not found');
    return u;
  }

  async findByEmail(email: string, exec: Executor = this.core.db): Promise<UserRow | null> {
    return exec.one<UserRow>('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email.toLowerCase()]);
  }

  async findByUid(uid: string, exec: Executor = this.core.db): Promise<UserRow | null> {
    return exec.one<UserRow>('SELECT * FROM users WHERE uid = ? AND deleted_at IS NULL', [uid]);
  }

  async toDto(row: UserRow): Promise<UserDto> {
    const sec = await this.core.db.one<{ totp_enabled: boolean; trading_pin_hash: string | null }>(
      'SELECT totp_enabled, trading_pin_hash FROM user_security WHERE user_id = ?',
      [row.id],
    );
    return {
      id: String(row.id),
      uid: row.uid,
      email: row.email,
      emailVerified: row.email_verified_at != null,
      phone: row.phone,
      phoneVerified: row.phone_verified_at != null,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      tradingEnabled: Boolean(row.trading_enabled),
      withdrawalsEnabled: Boolean(row.withdrawals_enabled),
      twoFactorEnabled: Boolean(sec?.totp_enabled),
      hasTradingPin: Boolean(sec?.trading_pin_hash),
      kycLevel: Number(row.kyc_level),
      vipTier: Number(row.vip_tier),
      permissions: this.permissionsFor(row.role),
      createdAt: toMsStrict(row.created_at),
      lastLoginAt: toMs(row.last_login_at),
    };
  }

  /**
   * Create a user with its security and settings rows. Retries UID generation on collision.
   * Throws EMAIL_TAKEN / PHONE_TAKEN on duplicates.
   */
  async createUser(
    exec: Executor,
    input: {
      email: string;
      passwordHash: string | null;
      displayName?: string | null;
      phone?: string | null;
      role?: UserRole;
      isSystem?: boolean;
      emailVerified?: boolean;
      referredBy?: string | null;
    },
  ): Promise<string> {
    const { generateUid } = await import('../crypto');
    const { isDuplicateKeyError } = await import('../errors');
    const { DEFAULT_NOTIFICATION_PREFS } = await import('./notifications');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await exec.execute(
          `INSERT INTO users (uid, email, email_verified_at, phone, password_hash, display_name, role, is_system, referred_by, referral_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            generateUid(),
            input.email.toLowerCase(),
            input.emailVerified ? new Date() : null,
            input.phone ?? null,
            input.passwordHash,
            input.displayName ?? null,
            input.role ?? 'USER',
            input.isSystem ? 1 : 0,
            input.referredBy ?? null,
            null,
          ],
        );
        const id = res.insertId;
        await exec.execute('INSERT INTO user_security (user_id, password_changed_at) VALUES (?, ?)', [
          id,
          input.passwordHash ? new Date() : null,
        ]);
        await exec.execute('INSERT INTO user_settings (user_id, notification_prefs) VALUES (?, ?)', [
          id,
          JSON.stringify(DEFAULT_NOTIFICATION_PREFS),
        ]);
        await exec.execute('UPDATE users SET referral_code = ? WHERE id = ?', [
          `GC${Number(id).toString(36).toUpperCase().padStart(6, '0')}`,
          id,
        ]);
        return id;
      } catch (e) {
        if (isDuplicateKeyError(e, 'uq_users_email'))
          throw new AppError('EMAIL_TAKEN', 'An account with this email already exists');
        if (isDuplicateKeyError(e, 'uq_users_phone'))
          throw new AppError('PHONE_TAKEN', 'This phone number is already registered');
        if (isDuplicateKeyError(e, 'uq_users_uid')) continue;
        throw e;
      }
    }
    throw new Error('could not allocate a unique uid');
  }

  /** Throws unless the user may trade. */
  async assertCanTrade(userId: string): Promise<UserFlags> {
    const f = await this.flags(userId);
    if (f.status === 'DISABLED') throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    if (f.status === 'FROZEN') throw new AppError('ACCOUNT_FROZEN', 'Account is frozen');
    if (!f.tradingEnabled) throw new AppError('TRADING_DISABLED', 'Trading is disabled for this account');
    if (this.core.settings.get('maintenance.trading_halted') && !f.isSystem) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Trading is temporarily halted for maintenance');
    }
    return f;
  }

  /** Throws unless the user may move funds out. */
  async assertCanWithdraw(userId: string): Promise<UserFlags> {
    const f = await this.flags(userId);
    if (f.status === 'DISABLED') throw new AppError('ACCOUNT_DISABLED', 'Account is disabled');
    if (f.status === 'FROZEN') throw new AppError('ACCOUNT_FROZEN', 'Account is frozen');
    if (!f.withdrawalsEnabled) throw new AppError('WITHDRAWALS_DISABLED', 'Withdrawals are disabled for this account');
    if (!f.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 'Verify your email before withdrawing');
    return f;
  }
}
