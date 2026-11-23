import type { ApiKeyCreatedDto, ApiKeyDto, ApiKeyPermission } from '@gocrypto/shared-types';
import type { CreateApiKeyInput } from '@gocrypto/validation';
import type { Core } from '../core';
import { decryptSecret, encryptSecret, hmacSha256Hex, randomToken, safeEqual } from '../crypto';
import { parseJson, toMs, toMsStrict } from '../db/database';
import { AppError } from '../errors';
import { TtlCache } from '../cache/ttl-cache';

interface ApiKeyRow {
  id: string;
  user_id: string;
  key_id: string;
  secret_enc: string;
  label: string;
  permissions: unknown;
  ip_whitelist: unknown;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

export interface ApiKeyAuth {
  userId: string;
  keyId: string;
  permissions: ApiKeyPermission[];
}

/** HMAC-signed API keys: X-GC-APIKEY, X-GC-TIMESTAMP, X-GC-SIGNATURE = hex(HMAC_SHA256(secret, ts+METHOD+path+body)). */
export class ApiKeyService {
  /** Bounded key cache; unknown key ids are cached briefly too, so random keys cannot hammer the database. */
  private cache = new TtlCache<string, ApiKeyRow | null>(50_000, 30_000);

  constructor(private readonly core: Core) {}

  private toDto(r: ApiKeyRow): ApiKeyDto {
    return {
      id: String(r.id),
      keyId: r.key_id,
      label: r.label,
      permissions: parseJson<ApiKeyPermission[]>(r.permissions, []),
      ipWhitelist: parseJson<string[]>(r.ip_whitelist, []),
      createdAt: toMsStrict(r.created_at),
      lastUsedAt: toMs(r.last_used_at),
      expiresAt: toMs(r.expires_at),
    };
  }

  async create(userId: string, input: CreateApiKeyInput): Promise<ApiKeyCreatedDto> {
    const count = await this.core.db.one<{ c: number }>(
      'SELECT COUNT(*) AS c FROM api_keys WHERE user_id = ? AND revoked_at IS NULL',
      [userId],
    );
    if (Number(count?.c ?? 0) >= 20) throw new AppError('CONFLICT', 'Maximum number of API keys reached');
    if (input.permissions.includes('WITHDRAW') && !input.ipWhitelist.length) {
      throw new AppError('VALIDATION_ERROR', 'Withdrawal-enabled API keys require an IP whitelist');
    }
    const keyId = randomToken(24).replace(/[-_]/g, 'x').slice(0, 32);
    const secret = randomToken(32);
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    const res = await this.core.db.execute(
      'INSERT INTO api_keys (user_id, key_id, secret_enc, label, permissions, ip_whitelist, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        userId,
        keyId,
        encryptSecret(secret),
        input.label,
        JSON.stringify(input.permissions),
        JSON.stringify(input.ipWhitelist),
        expiresAt,
      ],
    );
    const row = (await this.core.db.one<ApiKeyRow>('SELECT * FROM api_keys WHERE id = ?', [res.insertId]))!;
    await this.core.audit.log({
      actorUserId: userId,
      actorType: 'USER',
      action: 'security.api_key_created',
      targetType: 'API_KEY',
      targetId: keyId,
    });
    await this.core.notifications.notify({
      userId,
      type: 'SECURITY_CHANGE',
      title: 'API key created',
      body: `API key "${input.label}" was created.`,
    });
    return { ...this.toDto(row), secret };
  }

  async list(userId: string): Promise<ApiKeyDto[]> {
    const rows = await this.core.db.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC',
      [userId],
    );
    return rows.map((r) => this.toDto(r));
  }

  async revoke(userId: string, id: string): Promise<void> {
    const row = await this.core.db.one<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      [id, userId],
    );
    if (!row) throw new AppError('NOT_FOUND', 'API key not found');
    await this.core.db.execute('UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [id]);
    this.cache.delete(row.key_id);
    await this.core.audit.log({
      actorUserId: userId,
      actorType: 'USER',
      action: 'security.api_key_revoked',
      targetType: 'API_KEY',
      targetId: row.key_id,
    });
  }

  async authenticate(input: {
    keyId: string;
    timestamp: string;
    signature: string;
    method: string;
    path: string;
    body: string;
    ip: string | null;
  }): Promise<ApiKeyAuth> {
    const ts = Number(input.timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5_000)
      throw new AppError('SIGNATURE_INVALID', 'Request timestamp outside recvWindow');
    let row = this.cache.get(input.keyId);
    if (row === undefined) {
      row = await this.core.db.one<ApiKeyRow>('SELECT * FROM api_keys WHERE key_id = ?', [input.keyId]);
      this.cache.set(input.keyId, row, row ? undefined : 5_000);
    }
    if (!row) throw new AppError('API_KEY_INVALID', 'Invalid API key');
    if (row.revoked_at || (row.expires_at && row.expires_at.getTime() < Date.now()))
      throw new AppError('API_KEY_INVALID', 'API key revoked or expired');
    const whitelist = parseJson<string[]>(row.ip_whitelist, []);
    if (whitelist.length && (!input.ip || !whitelist.includes(input.ip)))
      throw new AppError('IP_NOT_ALLOWED', 'IP address not whitelisted for this key');
    const expected = hmacSha256Hex(
      decryptSecret(row.secret_enc),
      `${input.timestamp}${input.method.toUpperCase()}${input.path}${input.body}`,
    );
    if (!safeEqual(expected, input.signature.toLowerCase()))
      throw new AppError('SIGNATURE_INVALID', 'Invalid signature');
    // Replay protection within the recv window.
    const replay = await this.core.redis.main.set(`gc:apisig:${input.signature}`, '1', 'PX', 10_000, 'NX');
    if (replay !== 'OK') throw new AppError('SIGNATURE_INVALID', 'Duplicate request signature');
    if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) {
      row.last_used_at = new Date();
      void this.core.db
        .execute('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP(3), last_used_ip = ? WHERE id = ?', [
          input.ip,
          row.id,
        ])
        .catch(() => undefined);
    }
    return {
      userId: String(row.user_id),
      keyId: row.key_id,
      permissions: parseJson<ApiKeyPermission[]>(row.permissions, []),
    };
  }
}
