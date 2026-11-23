import type {
  AuthTokens,
  DeviceDto,
  LoginHistoryDto,
  LoginResult,
  Platform,
  SecurityAlertType,
  SecurityOverviewDto,
  SessionDto,
  TwoFactorSetupDto,
  UserDto,
} from '@gocrypto/shared-types';
import type { LoginInput, RegisterInput } from '@gocrypto/validation';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Core } from '../core';
import {
  burnPasswordCheck,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  hashPassword,
  otpauthUrl,
  randomToken,
  sha256Hex,
  uuid,
  verifyPassword,
  verifyTotp,
} from '../crypto';
import { type Executor, parseJson, toMs, toMsStrict } from '../db/database';
import { AppError } from '../errors';
import { metrics } from '../metrics';
import { OtpService } from './otp';
import { TokenService } from './tokens';
import type { UserRow } from './users';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
  platform?: Platform | null;
}

interface SecurityRow {
  user_id: string;
  totp_secret_enc: string | null;
  totp_pending_secret_enc: string | null;
  totp_enabled: boolean;
  totp_last_used_step: string | null;
  backup_codes: unknown;
  trading_pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: Date | null;
  failed_login_attempts: number;
  login_locked_until: Date | null;
  password_changed_at: Date | null;
  withdrawal_lock_until: Date | null;
  anti_phishing_code: string | null;
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function platformFrom(ctx: RequestContext): Platform {
  return ctx.platform ?? 'WEB';
}

function deviceIdFrom(ctx: RequestContext): string {
  return ctx.deviceId || `ua-${sha256Hex(ctx.userAgent ?? 'unknown').slice(0, 32)}`;
}

/** Authentication, sessions, devices and account security. */
export class AuthService {
  readonly tokens: TokenService;
  readonly otp: OtpService;

  constructor(private readonly core: Core) {
    this.tokens = new TokenService(core);
    this.otp = new OtpService(core);
  }

  // ───────────────────────── helpers ─────────────────────────

  async security(userId: string, exec: Executor = this.core.db): Promise<SecurityRow> {
    const row = await exec.one<SecurityRow>('SELECT * FROM user_security WHERE user_id = ?', [userId]);
    if (!row) throw new AppError('NOT_FOUND', 'Security profile missing');
    return row;
  }

  private async recordLogin(input: {
    userId: string | null;
    email: string | null;
    success: boolean;
    reason?: string | null;
    method?: string;
    ctx: RequestContext;
  }): Promise<void> {
    await this.core.db.execute(
      `INSERT INTO login_history (user_id, email, method, success, failure_reason, ip, user_agent, platform, device_id, device_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.email,
        input.method ?? 'PASSWORD',
        input.success ? 1 : 0,
        input.reason ?? null,
        input.ctx.ip,
        input.ctx.userAgent?.slice(0, 512) ?? null,
        platformFrom(input.ctx),
        input.ctx.deviceId ?? null,
        input.ctx.deviceName ?? null,
      ],
    );
    metrics.authEvents.inc({ event: input.success ? 'login_success' : 'login_failure' });
  }

  async alert(userId: string | null, type: SecurityAlertType, severity: 'LOW' | 'MEDIUM' | 'HIGH', ip: string | null, details: Record<string, unknown>) {
    await this.core.db.execute('INSERT INTO security_alerts (user_id, type, severity, ip, details) VALUES (?, ?, ?, ?, ?)', [
      userId,
      type,
      severity,
      ip,
      JSON.stringify(details),
    ]);
  }

  private async userDto(row: UserRow): Promise<UserDto> {
    return this.core.users.toDto(row);
  }

  /** Locks withdrawals for a period after sensitive security changes (account-takeover protection). */
  private async lockWithdrawals(exec: Executor, userId: string): Promise<void> {
    const hours = Number(this.core.settings.get('withdrawal.security_lock_hours'));
    if (hours <= 0) return;
    await exec.execute('UPDATE user_security SET withdrawal_lock_until = ? WHERE user_id = ?', [new Date(Date.now() + hours * 3600_000), userId]);
  }

  // ───────────────────────── devices & sessions ─────────────────────────

  async upsertDevice(exec: Executor, userId: string, ctx: RequestContext): Promise<{ rowId: string; isNew: boolean }> {
    const deviceId = deviceIdFrom(ctx);
    const existing = await exec.one<{ id: string; revoked_at: Date | null }>('SELECT id, revoked_at FROM user_devices WHERE user_id = ? AND device_id = ?', [
      userId,
      deviceId,
    ]);
    if (existing) {
      await exec.execute(
        `UPDATE user_devices SET last_seen_at = CURRENT_TIMESTAMP(3), last_ip = ?, user_agent = ?, name = COALESCE(?, name),
           platform = ?, revoked_at = NULL WHERE id = ?`,
        [ctx.ip, ctx.userAgent?.slice(0, 512) ?? null, ctx.deviceName ?? null, platformFrom(ctx), existing.id],
      );
      return { rowId: String(existing.id), isNew: existing.revoked_at != null };
    }
    const res = await exec.execute(
      `INSERT INTO user_devices (user_id, device_id, name, platform, user_agent, last_ip) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP(3)`,
      [userId, deviceId, ctx.deviceName ?? null, platformFrom(ctx), ctx.userAgent?.slice(0, 512) ?? null, ctx.ip],
    );
    return { rowId: res.insertId, isNew: true };
  }

  private async createSession(exec: Executor, user: UserRow, deviceRowId: string, ctx: RequestContext): Promise<AuthTokens> {
    const sessionId = uuid();
    const jti = randomToken(24);
    const expiresAt = Date.now() + this.core.config.JWT_REFRESH_TTL_SEC * 1000;
    await exec.execute(
      `INSERT INTO user_sessions (id, user_id, device_row_id, refresh_jti_hash, platform, ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, user.id, deviceRowId, sha256Hex(jti), platformFrom(ctx), ctx.ip, ctx.userAgent?.slice(0, 512) ?? null, new Date(expiresAt)],
    );
    return this.tokens.issuePair(String(user.id), sessionId, user.role, jti, expiresAt);
  }

  /** Final step shared by every login method: device, session, notifications, history. */
  private async completeLogin(user: UserRow, ctx: RequestContext, method: string): Promise<LoginResult> {
    const { tokens, isNewDevice } = await this.core.db.transaction(async (tx) => {
      const device = await this.upsertDevice(tx, String(user.id), ctx);
      const tokens = await this.createSession(tx, user, device.rowId, ctx);
      await tx.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [user.id]);
      await tx.execute('UPDATE user_security SET failed_login_attempts = 0, login_locked_until = NULL WHERE user_id = ?', [user.id]);
      return { tokens, isNewDevice: device.isNew };
    });
    await this.recordLogin({ userId: String(user.id), email: user.email, success: true, method, ctx });
    const priorLogins = await this.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM login_history WHERE user_id = ? AND success = 1', [user.id]);
    if (isNewDevice && Number(priorLogins?.c ?? 0) > 1) {
      await this.core.notifications.notify({
        userId: String(user.id),
        type: 'NEW_DEVICE_LOGIN',
        title: 'New device sign-in',
        body: `New sign-in from ${ctx.deviceName ?? ctx.userAgent?.slice(0, 60) ?? 'an unknown device'} (${ctx.ip ?? 'unknown IP'}).`,
        data: { ip: ctx.ip, platform: platformFrom(ctx) },
      });
      await this.alert(String(user.id), 'NEW_DEVICE', 'LOW', ctx.ip, { userAgent: ctx.userAgent, platform: platformFrom(ctx) });
    }
    const fresh = (await this.core.users.findById(String(user.id)))!;
    return { status: 'OK', user: await this.userDto(fresh), tokens };
  }

  // ───────────────────────── registration & login ─────────────────────────

  async register(input: RegisterInput, ctx: RequestContext): Promise<{ user: UserDto; tokens: AuthTokens }> {
    let referredBy: string | null = null;
    if (input.referralCode) {
      const ref = await this.core.db.one<{ id: string }>('SELECT id FROM users WHERE referral_code = ?', [input.referralCode]);
      referredBy = ref ? String(ref.id) : null;
    }
    const passwordHash = await hashPassword(input.password);
    const userId = await this.core.db.transaction((tx) =>
      this.core.users.createUser(tx, {
        email: input.email,
        passwordHash,
        displayName: input.displayName ?? null,
        phone: input.phone ?? null,
        referredBy,
      }),
    );
    const user = (await this.core.users.findById(userId))!;
    await this.core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'auth.register', targetType: 'USER', targetId: userId, ip: ctx.ip, userAgent: ctx.userAgent });
    metrics.authEvents.inc({ event: 'register' });
    await this.sendEmailVerification(userId).catch(() => undefined);
    const result = await this.completeLogin(user, ctx, 'REGISTER');
    if (result.status !== 'OK') throw new Error('unexpected MFA on registration');
    return { user: result.user, tokens: result.tokens };
  }

  async login(input: LoginInput, ctx: RequestContext): Promise<LoginResult> {
    const user = await this.core.users.findByEmail(input.email);
    if (!user || !user.password_hash || user.is_system) {
      await burnPasswordCheck(input.password);
      await this.recordLogin({ userId: user ? String(user.id) : null, email: input.email, success: false, reason: 'INVALID_CREDENTIALS', ctx });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const sec = await this.security(String(user.id));
    if (sec.login_locked_until && sec.login_locked_until.getTime() > Date.now()) {
      await this.recordLogin({ userId: String(user.id), email: user.email, success: false, reason: 'ACCOUNT_LOCKED', ctx });
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
        details: { lockedUntil: sec.login_locked_until.getTime() },
      });
    }
    if (!(await verifyPassword(user.password_hash, input.password))) {
      const max = Number(this.core.settings.get('security.max_login_attempts'));
      const attempts = sec.failed_login_attempts + 1;
      const lockUntil = attempts >= max ? new Date(Date.now() + Number(this.core.settings.get('security.login_lock_minutes')) * 60_000) : null;
      await this.core.db.execute('UPDATE user_security SET failed_login_attempts = ?, login_locked_until = ? WHERE user_id = ?', [
        lockUntil ? 0 : attempts,
        lockUntil,
        user.id,
      ]);
      await this.recordLogin({ userId: String(user.id), email: user.email, success: false, reason: 'INVALID_PASSWORD', ctx });
      if (lockUntil) await this.alert(String(user.id), 'FAILED_LOGINS', 'MEDIUM', ctx.ip, { attempts });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.status === 'DISABLED') {
      await this.recordLogin({ userId: String(user.id), email: user.email, success: false, reason: 'ACCOUNT_DISABLED', ctx });
      throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled');
    }
    if (sec.totp_enabled) {
      const mfaToken = await this.tokens.signMfa(String(user.id), sha256Hex(`${deviceIdFrom(ctx)}|${ctx.userAgent ?? ''}`));
      return { status: 'MFA_REQUIRED', mfaToken, methods: ['TOTP', 'BACKUP_CODE'] };
    }
    return this.completeLogin(user, ctx, 'PASSWORD');
  }

  async loginMfa(input: { mfaToken: string; code?: string; backupCode?: string }, ctx: RequestContext): Promise<LoginResult> {
    const claims = await this.tokens.verifyMfa(input.mfaToken);
    if (claims.fingerprint !== sha256Hex(`${deviceIdFrom(ctx)}|${ctx.userAgent ?? ''}`)) {
      throw new AppError('TOKEN_INVALID', 'MFA token was issued to a different device');
    }
    const used = await this.core.redis.main.set(`gc:mfa:used:${claims.jti}`, '1', 'EX', 600, 'NX');
    if (used !== 'OK') throw new AppError('TOKEN_INVALID', 'MFA token already used');
    const user = await this.core.users.findById(claims.userId);
    if (!user) throw new AppError('INVALID_CREDENTIALS', 'Invalid credentials');
    try {
      if (input.backupCode) await this.consumeBackupCode(String(user.id), input.backupCode);
      else await this.verifyTotpFor(String(user.id), input.code ?? '');
    } catch (e) {
      await this.core.redis.main.del(`gc:mfa:used:${claims.jti}`);
      await this.recordLogin({ userId: String(user.id), email: user.email, success: false, reason: 'INVALID_MFA', method: 'TOTP', ctx });
      throw e;
    }
    return this.completeLogin(user, ctx, input.backupCode ? 'BACKUP_CODE' : 'TOTP');
  }

  /** Refresh-token rotation with reuse detection (a replayed token revokes the whole session). */
  async refresh(refreshToken: string, ctx: RequestContext): Promise<AuthTokens> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    const session = await this.core.db.one<{
      id: string;
      user_id: string;
      refresh_jti_hash: string;
      previous_jti_hash: string | null;
      rotated_at: Date | null;
      expires_at: Date;
      revoked_at: Date | null;
    }>('SELECT * FROM user_sessions WHERE id = ?', [claims.sessionId]);
    if (!session || String(session.user_id) !== claims.userId || session.revoked_at) throw new AppError('TOKEN_REVOKED', 'Session has ended');
    if (session.expires_at.getTime() < Date.now()) throw new AppError('TOKEN_EXPIRED', 'Session expired');
    const presented = sha256Hex(claims.jti);
    if (presented !== session.refresh_jti_hash) {
      const recentlyRotated = session.previous_jti_hash === presented && session.rotated_at && Date.now() - session.rotated_at.getTime() < 20_000;
      if (recentlyRotated) throw new AppError('CONFLICT', 'Refresh token was just rotated; use the latest token');
      await this.revokeSessions(claims.userId, [claims.sessionId], 'REFRESH_REUSE');
      await this.alert(claims.userId, 'REFRESH_TOKEN_REUSE', 'HIGH', ctx.ip, { sessionId: claims.sessionId });
      await this.core.notifications.notify({
        userId: claims.userId,
        type: 'SECURITY_CHANGE',
        title: 'Session revoked',
        body: 'A previously used sign-in token was replayed. The session was revoked to protect your account.',
      });
      throw new AppError('REFRESH_TOKEN_REUSED', 'Refresh token reuse detected; please sign in again');
    }
    const user = await this.core.users.findById(claims.userId);
    if (!user || user.status === 'DISABLED') throw new AppError('ACCOUNT_DISABLED', 'Account disabled');
    const newJti = randomToken(24);
    const res = await this.core.db.execute(
      `UPDATE user_sessions SET previous_jti_hash = refresh_jti_hash, refresh_jti_hash = ?, rotated_at = CURRENT_TIMESTAMP(3),
         rotation_counter = rotation_counter + 1, last_used_at = CURRENT_TIMESTAMP(3), ip = ?
       WHERE id = ? AND refresh_jti_hash = ? AND revoked_at IS NULL`,
      [sha256Hex(newJti), ctx.ip, session.id, presented],
    );
    if (res.affectedRows !== 1) throw new AppError('CONFLICT', 'Refresh token was just rotated; use the latest token');
    metrics.authEvents.inc({ event: 'refresh' });
    return this.tokens.issuePair(String(user.id), session.id, user.role, newJti, session.expires_at.getTime());
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.revokeSessions(userId, [sessionId], 'LOGOUT');
  }

  async revokeSessions(userId: string, sessionIds: string[] | 'ALL', reason: string, exceptSessionId?: string): Promise<number> {
    let ids: string[];
    if (sessionIds === 'ALL') {
      const rows = await this.core.db.query<{ id: string }>('SELECT id FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL', [userId]);
      ids = rows.map((r) => r.id).filter((id) => id !== exceptSessionId);
    } else ids = sessionIds;
    if (!ids.length) return 0;
    const res = await this.core.db.execute(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      [reason, userId, ...ids],
    );
    await this.tokens.markRevoked(ids);
    this.core.bus.emit('session.revoked', { userId, sessionIds: ids });
    return res.affectedRows;
  }

  async sessions(userId: string, currentSessionId: string): Promise<SessionDto[]> {
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT s.*, d.name AS device_name FROM user_sessions s LEFT JOIN user_devices d ON d.id = s.device_row_id
        WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP(3) ORDER BY s.last_used_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      deviceName: (r.device_name as string | null) ?? null,
      platform: r.platform as Platform,
      ip: (r.ip as string | null) ?? null,
      userAgent: (r.user_agent as string | null) ?? null,
      createdAt: toMsStrict(r.created_at),
      lastUsedAt: toMsStrict(r.last_used_at),
      expiresAt: toMsStrict(r.expires_at),
      current: r.id === currentSessionId,
    }));
  }

  async devices(userId: string, currentDeviceId?: string | null): Promise<DeviceDto[]> {
    const rows = await this.core.db.query<Record<string, unknown>>(
      'SELECT * FROM user_devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC',
      [userId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      deviceId: String(r.device_id),
      name: (r.name as string | null) ?? null,
      platform: r.platform as Platform,
      lastIp: (r.last_ip as string | null) ?? null,
      lastSeenAt: toMsStrict(r.last_seen_at),
      trusted: Boolean(r.trusted),
      pushEnabled: Boolean(r.push_token),
      createdAt: toMsStrict(r.created_at),
      current: Boolean(currentDeviceId && r.device_id === currentDeviceId),
    }));
  }

  async updateDevice(userId: string, id: string, input: { name?: string; trusted?: boolean }): Promise<void> {
    const res = await this.core.db.execute(
      'UPDATE user_devices SET name = COALESCE(?, name), trusted = COALESCE(?, trusted) WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      [input.name ?? null, input.trusted === undefined ? null : input.trusted ? 1 : 0, id, userId],
    );
    if (res.affectedRows === 0) throw new AppError('NOT_FOUND', 'Device not found');
  }

  async removeDevice(userId: string, id: string): Promise<void> {
    const res = await this.core.db.execute(
      'UPDATE user_devices SET revoked_at = CURRENT_TIMESTAMP(3), push_token = NULL WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      [id, userId],
    );
    if (res.affectedRows === 0) throw new AppError('NOT_FOUND', 'Device not found');
    const sessions = await this.core.db.query<{ id: string }>('SELECT id FROM user_sessions WHERE device_row_id = ? AND revoked_at IS NULL', [id]);
    await this.revokeSessions(userId, sessions.map((s) => s.id), 'DEVICE_REMOVED');
  }

  async registerPushToken(userId: string, ctx: RequestContext, token: string, provider: string): Promise<void> {
    const device = await this.upsertDevice(this.core.db, userId, ctx);
    await this.core.db.execute('UPDATE user_devices SET push_token = ?, push_provider = ? WHERE id = ?', [token, provider, device.rowId]);
  }

  async loginHistory(userId: string, limit = 50, cursor?: string): Promise<{ items: LoginHistoryDto[]; nextCursor: string | null }> {
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT * FROM login_history WHERE user_id = ? ${cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      cursor ? [userId, cursor, limit + 1] : [userId, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: String(r.id),
        success: Boolean(r.success),
        reason: (r.failure_reason as string | null) ?? null,
        ip: (r.ip as string | null) ?? null,
        userAgent: (r.user_agent as string | null) ?? null,
        platform: (r.platform as Platform | null) ?? null,
        deviceName: (r.device_name as string | null) ?? null,
        createdAt: toMsStrict(r.created_at),
      })),
      nextCursor: rows.length > limit ? String(page[page.length - 1]!.id) : null,
    };
  }

  // ───────────────────────── email / phone verification ─────────────────────────

  async sendEmailVerification(userId: string): Promise<void> {
    const user = await this.core.users.requireById(userId);
    if (user.email_verified_at) return;
    const code = await this.otp.issue('email_verify', userId);
    await this.core.queues.email({ to: user.email, subject: 'Verify your GoCrypto email', template: 'verify_email', vars: { code } });
  }

  async verifyEmail(userId: string, code: string): Promise<void> {
    await this.otp.verify('email_verify', userId, code);
    await this.core.db.execute('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND email_verified_at IS NULL', [userId]);
    this.core.users.invalidate(userId);
  }

  async sendPhoneOtp(userId: string, phone: string): Promise<void> {
    const taken = await this.core.db.one<{ id: string }>('SELECT id FROM users WHERE phone = ? AND id <> ?', [phone, userId]);
    if (taken) throw new AppError('PHONE_TAKEN', 'This phone number is already registered');
    const code = await this.otp.issue('phone_verify', `${userId}:${phone}`);
    await this.core.queues.sms({ to: phone, body: `Your GoCrypto verification code is ${code}` });
  }

  async verifyPhone(userId: string, phone: string, code: string): Promise<void> {
    await this.otp.verify('phone_verify', `${userId}:${phone}`, code);
    try {
      await this.core.db.execute('UPDATE users SET phone = ?, phone_verified_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [phone, userId]);
    } catch {
      throw new AppError('PHONE_TAKEN', 'This phone number is already registered');
    }
    await this.core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'security.phone_verified', targetType: 'USER', targetId: userId });
  }

  // ───────────────────────── passwords ─────────────────────────

  /** Always succeeds from the caller's perspective (no account enumeration). */
  async forgotPassword(email: string, ctx: RequestContext): Promise<void> {
    const user = await this.core.users.findByEmail(email);
    if (!user || user.is_system) return;
    try {
      const code = await this.otp.issue('password_reset', email.toLowerCase(), { ttlSec: 900 });
      const sec = await this.security(String(user.id));
      await this.core.queues.email({
        to: user.email,
        subject: 'Reset your GoCrypto password',
        template: 'password_reset',
        vars: { code },
        antiPhishingCode: sec.anti_phishing_code,
      });
      await this.core.audit.log({ actorUserId: String(user.id), actorType: 'USER', action: 'auth.password_reset_requested', ip: ctx.ip });
    } catch (e) {
      if (!(e instanceof AppError && e.code === 'OTP_RATE_LIMITED')) throw e;
    }
  }

  async resetPassword(email: string, code: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const user = await this.core.users.findByEmail(email);
    if (!user) throw new AppError('INVALID_OTP', 'Invalid code');
    await this.otp.verify('password_reset', email.toLowerCase(), code);
    const hash = await hashPassword(newPassword);
    await this.core.db.transaction(async (tx) => {
      await tx.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
      await tx.execute(
        'UPDATE user_security SET password_changed_at = CURRENT_TIMESTAMP(3), failed_login_attempts = 0, login_locked_until = NULL WHERE user_id = ?',
        [user.id],
      );
      await this.lockWithdrawals(tx, String(user.id));
    });
    await this.revokeSessions(String(user.id), 'ALL', 'PASSWORD_RESET');
    await this.core.audit.log({ actorUserId: String(user.id), actorType: 'USER', action: 'security.password_reset', ip: ctx.ip, userAgent: ctx.userAgent });
    await this.core.notifications.notify({
      userId: String(user.id),
      type: 'SECURITY_CHANGE',
      title: 'Password reset',
      body: 'Your password was reset and all sessions were signed out. Withdrawals are paused for 24 hours.',
    });
  }

  async changePassword(userId: string, sessionId: string, input: { currentPassword: string; newPassword: string; totpCode?: string }, ctx: RequestContext) {
    const user = await this.core.users.requireById(userId);
    if (!user.password_hash || !(await verifyPassword(user.password_hash, input.currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const sec = await this.security(userId);
    if (sec.totp_enabled) await this.verifyTotpFor(userId, input.totpCode ?? '');
    const hash = await hashPassword(input.newPassword);
    await this.core.db.transaction(async (tx) => {
      await tx.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
      await tx.execute('UPDATE user_security SET password_changed_at = CURRENT_TIMESTAMP(3) WHERE user_id = ?', [userId]);
      await this.lockWithdrawals(tx, userId);
    });
    await this.revokeSessions(userId, 'ALL', 'PASSWORD_CHANGED', sessionId);
    await this.core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'security.password_changed', ip: ctx.ip, userAgent: ctx.userAgent });
    await this.core.notifications.notify({
      userId,
      type: 'SECURITY_CHANGE',
      title: 'Password changed',
      body: 'Your password was changed. Other sessions were signed out and withdrawals are paused for 24 hours.',
    });
  }

  // ───────────────────────── OAuth ─────────────────────────

  async oauthGoogle(idToken: string, ctx: RequestContext): Promise<LoginResult> {
    const audience = this.core.config.GOOGLE_CLIENT_IDS;
    if (!audience.length) throw new AppError('OAUTH_FAILED', 'Google sign-in is not configured');
    try {
      const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience });
      if (!payload.sub || !payload.email || payload.email_verified !== true) throw new Error('unverified email');
      return this.oauthLogin('GOOGLE', payload.sub, String(payload.email), (payload.name as string | undefined) ?? null, ctx);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('OAUTH_FAILED', 'Google token could not be verified');
    }
  }

  async oauthApple(identityToken: string, nonce: string | undefined, fullName: string | undefined, ctx: RequestContext): Promise<LoginResult> {
    const audience = this.core.config.APPLE_CLIENT_IDS;
    if (!audience.length) throw new AppError('OAUTH_FAILED', 'Apple sign-in is not configured');
    try {
      const { payload } = await jwtVerify(identityToken, APPLE_JWKS, { issuer: 'https://appleid.apple.com', audience });
      if (nonce && payload.nonce !== sha256Hex(nonce)) throw new Error('nonce mismatch');
      if (!payload.sub || !payload.email) throw new Error('missing email');
      return this.oauthLogin('APPLE', payload.sub, String(payload.email), fullName ?? null, ctx);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('OAUTH_FAILED', 'Apple token could not be verified');
    }
  }

  private async oauthLogin(provider: 'GOOGLE' | 'APPLE', subject: string, email: string, name: string | null, ctx: RequestContext): Promise<LoginResult> {
    const identity = await this.core.db.one<{ user_id: string }>('SELECT user_id FROM user_identities WHERE provider = ? AND provider_user_id = ?', [
      provider,
      subject,
    ]);
    let user: UserRow | null = identity ? await this.core.users.findById(String(identity.user_id)) : null;
    if (!user) {
      user = await this.core.users.findByEmail(email);
      if (!user) {
        const id = await this.core.db.transaction((tx) =>
          this.core.users.createUser(tx, { email, passwordHash: null, displayName: name, emailVerified: true }),
        );
        user = (await this.core.users.findById(id))!;
        await this.core.audit.log({ actorUserId: id, actorType: 'USER', action: `auth.register_${provider.toLowerCase()}`, ip: ctx.ip });
      }
      await this.core.db.execute('INSERT IGNORE INTO user_identities (user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?)', [
        user.id,
        provider,
        subject,
        email,
      ]);
    }
    if (user.status === 'DISABLED') throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled');
    const sec = await this.security(String(user.id));
    if (sec.totp_enabled) {
      const mfaToken = await this.tokens.signMfa(String(user.id), sha256Hex(`${deviceIdFrom(ctx)}|${ctx.userAgent ?? ''}`));
      return { status: 'MFA_REQUIRED', mfaToken, methods: ['TOTP', 'BACKUP_CODE'] };
    }
    return this.completeLogin(user, ctx, provider);
  }

  // ───────────────────────── 2FA (TOTP) ─────────────────────────

  async setupTotp(userId: string): Promise<TwoFactorSetupDto> {
    const user = await this.core.users.requireById(userId);
    const sec = await this.security(userId);
    if (sec.totp_enabled) throw new AppError('MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.core.db.execute('UPDATE user_security SET totp_pending_secret_enc = ? WHERE user_id = ?', [encryptSecret(secret), userId]);
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  async enableTotp(userId: string, code: string, ctx: RequestContext): Promise<{ backupCodes: string[] }> {
    const sec = await this.security(userId);
    if (sec.totp_enabled) throw new AppError('MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    if (!sec.totp_pending_secret_enc) throw new AppError('BAD_REQUEST', 'Start 2FA setup first');
    const secret = decryptSecret(sec.totp_pending_secret_enc);
    const step = verifyTotp(secret, code);
    if (step === null) throw new AppError('INVALID_MFA_CODE', 'Invalid authentication code');
    const backup = generateBackupCodes();
    await this.core.db.execute(
      `UPDATE user_security SET totp_secret_enc = totp_pending_secret_enc, totp_pending_secret_enc = NULL, totp_enabled = 1,
         totp_enabled_at = CURRENT_TIMESTAMP(3), totp_last_used_step = ?, backup_codes = ? WHERE user_id = ?`,
      [step, JSON.stringify(backup.hashes), userId],
    );
    await this.core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'security.2fa_enabled', ip: ctx.ip, userAgent: ctx.userAgent });
    await this.core.notifications.notify({ userId, type: 'SECURITY_CHANGE', title: '2FA enabled', body: 'Two-factor authentication is now protecting your account.' });
    return { backupCodes: backup.codes };
  }

  async disableTotp(userId: string, code: string, password: string, ctx: RequestContext): Promise<void> {
    const user = await this.core.users.requireById(userId);
    if (user.password_hash && !(await verifyPassword(user.password_hash, password))) {
      throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect');
    }
    await this.verifyTotpFor(userId, code);
    await this.core.db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE user_security SET totp_secret_enc = NULL, totp_enabled = 0, totp_enabled_at = NULL, backup_codes = NULL,
           totp_last_used_step = NULL WHERE user_id = ?`,
        [userId],
      );
      await this.lockWithdrawals(tx, userId);
    });
    await this.core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'security.2fa_disabled', ip: ctx.ip, userAgent: ctx.userAgent });
    await this.core.notifications.notify({
      userId,
      type: 'SECURITY_CHANGE',
      title: '2FA disabled',
      body: 'Two-factor authentication was turned off. Withdrawals are paused for 24 hours.',
    });
  }

  /** Verify a TOTP code with replay protection (a code can be used once). */
  async verifyTotpFor(userId: string, code: string): Promise<void> {
    const sec = await this.security(userId);
    if (!sec.totp_enabled || !sec.totp_secret_enc) throw new AppError('MFA_NOT_ENABLED', 'Two-factor authentication is not enabled');
    const step = verifyTotp(decryptSecret(sec.totp_secret_enc), code, {
      lastUsedStep: sec.totp_last_used_step == null ? null : Number(sec.totp_last_used_step),
    });
    if (step === null) throw new AppError('INVALID_MFA_CODE', 'Invalid authentication code');
    const res = await this.core.db.execute(
      'UPDATE user_security SET totp_last_used_step = ? WHERE user_id = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)',
      [step, userId, step],
    );
    if (res.affectedRows !== 1) throw new AppError('INVALID_MFA_CODE', 'Authentication code already used');
  }

  private async consumeBackupCode(userId: string, code: string): Promise<void> {
    await this.core.db.transaction(async (tx) => {
      const sec = await tx.one<{ backup_codes: unknown }>('SELECT backup_codes FROM user_security WHERE user_id = ? FOR UPDATE', [userId]);
      const hashes = parseJson<string[]>(sec?.backup_codes, []);
      const h = hashBackupCode(code);
      if (!hashes.includes(h)) throw new AppError('INVALID_MFA_CODE', 'Invalid backup code');
      await tx.execute('UPDATE user_security SET backup_codes = ? WHERE user_id = ?', [JSON.stringify(hashes.filter((x) => x !== h)), userId]);
    });
  }

  // ───────────────────────── trading / withdrawal PIN ─────────────────────────

  async setPin(userId: string, pin: string, password: string, ctx: RequestContext): Promise<void> {
    const user = await this.core.users.requireById(userId);
    const sec = await this.security(userId);
    if (sec.trading_pin_hash) throw new AppError('CONFLICT', 'A PIN is already set; use change PIN');
    if (user.password_hash && !(await verifyPassword(user.password_hash, password))) {
      throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect');
    }
    await this.core.db.execute('UPDATE user_security SET trading_pin_hash = ?, pin_failed_attempts = 0, pin_locked_until = NULL WHERE user_id = ?', [
      await hashPassword(pin),
      userId,
    ]);
    await this.core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'security.pin_set', ip: ctx.ip });
    await this.core.notifications.notify({ userId, type: 'SECURITY_CHANGE', title: 'Trading PIN set', body: 'Your trading / withdrawal PIN was set.' });
  }

  async changePin(userId: string, currentPin: string, newPin: string, ctx: RequestContext): Promise<void> {
    await this.verifyPin(userId, currentPin);
    await this.core.db.transaction(async (tx) => {
      await tx.execute('UPDATE user_security SET trading_pin_hash = ? WHERE user_id = ?', [await hashPassword(newPin), userId]);
      await this.lockWithdrawals(tx, userId);
    });
    await this.core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'security.pin_changed', ip: ctx.ip });
    await this.core.notifications.notify({ userId, type: 'SECURITY_CHANGE', title: 'Trading PIN changed', body: 'Your PIN was changed. Withdrawals are paused for 24 hours.' });
  }

  /** Verify the PIN with an attempt budget and temporary lockout. */
  async verifyPin(userId: string, pin: string): Promise<void> {
    const sec = await this.security(userId);
    if (!sec.trading_pin_hash) throw new AppError('PIN_NOT_SET', 'Set a trading PIN first');
    if (sec.pin_locked_until && sec.pin_locked_until.getTime() > Date.now()) {
      throw new AppError('PIN_LOCKED', 'PIN is locked after too many attempts', { details: { lockedUntil: sec.pin_locked_until.getTime() } });
    }
    if (!(await verifyPassword(sec.trading_pin_hash, pin))) {
      const max = Number(this.core.settings.get('security.pin_max_attempts'));
      const attempts = sec.pin_failed_attempts + 1;
      const lockUntil = attempts >= max ? new Date(Date.now() + Number(this.core.settings.get('security.pin_lock_minutes')) * 60_000) : null;
      await this.core.db.execute('UPDATE user_security SET pin_failed_attempts = ?, pin_locked_until = ? WHERE user_id = ?', [
        lockUntil ? 0 : attempts,
        lockUntil,
        userId,
      ]);
      if (lockUntil) await this.alert(userId, 'PIN_LOCKED', 'MEDIUM', null, { attempts });
      throw new AppError('INVALID_PIN', 'Incorrect PIN', { details: { remainingAttempts: Math.max(0, max - attempts) } });
    }
    if (sec.pin_failed_attempts > 0) await this.core.db.execute('UPDATE user_security SET pin_failed_attempts = 0 WHERE user_id = ?', [userId]);
  }

  // ───────────────────────── overview ─────────────────────────

  async securityOverview(userId: string): Promise<SecurityOverviewDto> {
    const user = await this.core.users.requireById(userId);
    const sec = await this.security(userId);
    const sessions = await this.core.db.one<{ c: number }>(
      'SELECT COUNT(*) AS c FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)',
      [userId],
    );
    const devices = await this.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM user_devices WHERE user_id = ? AND revoked_at IS NULL', [userId]);
    let score = 20;
    if (user.email_verified_at) score += 20;
    if (sec.totp_enabled) score += 30;
    if (sec.trading_pin_hash) score += 15;
    if (user.phone_verified_at) score += 10;
    if (sec.anti_phishing_code) score += 5;
    return {
      emailVerified: user.email_verified_at != null,
      phoneVerified: user.phone_verified_at != null,
      twoFactorEnabled: Boolean(sec.totp_enabled),
      hasTradingPin: Boolean(sec.trading_pin_hash),
      antiPhishingCodeSet: Boolean(sec.anti_phishing_code),
      activeSessions: Number(sessions?.c ?? 0),
      devices: Number(devices?.c ?? 0),
      passwordChangedAt: toMs(sec.password_changed_at),
      withdrawalLockUntil: sec.withdrawal_lock_until && sec.withdrawal_lock_until.getTime() > Date.now() ? sec.withdrawal_lock_until.getTime() : null,
      securityScore: Math.min(100, score),
    };
  }

  /** Admin: reset 2FA / PIN and revoke sessions after identity verification by support. */
  async adminResetSecurity(adminId: string, userId: string, opts: { resetTwoFactor: boolean; resetPin: boolean; revokeSessions: boolean; reason: string }) {
    await this.core.db.transaction(async (tx) => {
      if (opts.resetTwoFactor) {
        await tx.execute(
          'UPDATE user_security SET totp_secret_enc = NULL, totp_pending_secret_enc = NULL, totp_enabled = 0, backup_codes = NULL, totp_last_used_step = NULL WHERE user_id = ?',
          [userId],
        );
      }
      if (opts.resetPin) await tx.execute('UPDATE user_security SET trading_pin_hash = NULL, pin_failed_attempts = 0, pin_locked_until = NULL WHERE user_id = ?', [userId]);
      await tx.execute('UPDATE user_security SET failed_login_attempts = 0, login_locked_until = NULL WHERE user_id = ?', [userId]);
      await this.lockWithdrawals(tx, userId);
      await this.core.audit.log({ actorUserId: adminId, actorType: 'ADMIN', action: 'admin.user.reset_security', targetType: 'USER', targetId: userId, metadata: opts }, tx);
    });
    if (opts.revokeSessions) await this.revokeSessions(userId, 'ALL', 'ADMIN_RESET');
    await this.core.notifications.notify({
      userId,
      type: 'SECURITY_CHANGE',
      title: 'Security settings reset',
      body: 'Support reset your security settings. Withdrawals are paused for 24 hours.',
    });
  }
}
