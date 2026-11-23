import type { AuditLogDto } from '@gocrypto/shared-types';
import type { Core } from '../core';
import { type Executor, parseJson, toMsStrict } from '../db/database';
import { getLogger } from '../logger';

export interface AuditEntry {
  actorUserId?: string | null;
  actorType: 'USER' | 'ADMIN' | 'SYSTEM';
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Append-only audit trail for security-relevant and administrative actions. */
export class AuditService {
  constructor(private readonly core: Core) {}

  async log(entry: AuditEntry, exec: Executor = this.core.db): Promise<void> {
    try {
      await exec.execute(
        `INSERT INTO audit_logs (actor_user_id, actor_type, action, target_type, target_id, ip, user_agent, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.actorUserId ?? null,
          entry.actorType,
          entry.action,
          entry.targetType ?? null,
          entry.targetId ?? null,
          entry.ip ?? null,
          entry.userAgent?.slice(0, 512) ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ],
      );
    } catch (e) {
      // Inside a transaction the error must propagate so the whole operation rolls back.
      if (exec !== this.core.db) throw e;
      getLogger().error({ err: e, action: entry.action }, 'failed to write audit log');
    }
  }

  async list(q: {
    page: number;
    pageSize: number;
    userId?: string;
    q?: string;
    type?: string;
    from?: number;
    to?: number;
  }): Promise<{ items: AuditLogDto[]; total: number }> {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.userId) {
      where.push('(a.actor_user_id = ? OR (a.target_type = ? AND a.target_id = ?))');
      params.push(q.userId, 'USER', q.userId);
    }
    if (q.type) {
      where.push('a.action LIKE ?');
      params.push(`${q.type}%`);
    }
    if (q.q) {
      where.push('(a.action LIKE ? OR u.email LIKE ? OR a.ip = ?)');
      params.push(`%${q.q}%`, `%${q.q}%`, q.q);
    }
    if (q.from) {
      where.push('a.created_at >= ?');
      params.push(new Date(q.from));
    }
    if (q.to) {
      where.push('a.created_at <= ?');
      params.push(new Date(q.to));
    }
    const total = await this.core.db.one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT a.*, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return {
      total: Number(total?.c ?? 0),
      items: rows.map((r) => ({
        id: String(r.id),
        actorId: r.actor_user_id == null ? null : String(r.actor_user_id),
        actorEmail: (r.actor_email as string | null) ?? null,
        actorType: r.actor_type as AuditLogDto['actorType'],
        action: String(r.action),
        targetType: (r.target_type as string | null) ?? null,
        targetId: (r.target_id as string | null) ?? null,
        ip: (r.ip as string | null) ?? null,
        metadata: parseJson<Record<string, unknown> | null>(r.metadata, null),
        createdAt: toMsStrict(r.created_at),
      })),
    };
  }
}
