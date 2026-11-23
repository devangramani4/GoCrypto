import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_OF,
  type NotificationDto,
  type NotificationPrefs,
  type NotificationType,
  userChannel,
} from '@gocrypto/shared-types';
import type { Core } from '../core';
import { type Executor, parseJson, toMsStrict } from '../db/database';
import { getLogger } from '../logger';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  TRADING: { IN_APP: true, EMAIL: false, PUSH: true },
  WALLET: { IN_APP: true, EMAIL: true, PUSH: true },
  SECURITY: { IN_APP: true, EMAIL: true, PUSH: true },
  SYSTEM: { IN_APP: true, EMAIL: false, PUSH: false },
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * In-app + email + push notifications. In-app rows are written synchronously (optionally inside the
 * caller's transaction); email and push are queued for the workers service. Security notifications
 * cannot be disabled.
 */
export class NotificationService {
  private prefsCache = new Map<string, { prefs: NotificationPrefs; email: string; antiPhishing: string | null; at: number }>();

  constructor(private readonly core: Core) {}

  invalidate(userId: string): void {
    this.prefsCache.delete(userId);
  }

  private async profile(userId: string) {
    const c = this.prefsCache.get(userId);
    if (c && Date.now() - c.at < 60_000) return c;
    const row = await this.core.db.one<{ email: string; notification_prefs: unknown; anti_phishing_code: string | null }>(
      `SELECT u.email, s.notification_prefs, sec.anti_phishing_code
         FROM users u
         LEFT JOIN user_settings s ON s.user_id = u.id
         LEFT JOIN user_security sec ON sec.user_id = u.id
        WHERE u.id = ?`,
      [userId],
    );
    const stored = parseJson<Partial<NotificationPrefs>>(row?.notification_prefs, {});
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS } as NotificationPrefs;
    for (const cat of NOTIFICATION_CATEGORIES) prefs[cat] = { ...DEFAULT_NOTIFICATION_PREFS[cat], ...(stored[cat] ?? {}) };
    const entry = { prefs, email: row?.email ?? '', antiPhishing: row?.anti_phishing_code ?? null, at: Date.now() };
    this.prefsCache.set(userId, entry);
    return entry;
  }

  /** Persist + fan out a notification. Pass a transaction to make the in-app row atomic with the event. */
  async notify(input: NotifyInput, exec?: Executor & { afterCommit?: (fn: () => void | Promise<void>) => void }): Promise<void> {
    if (this.core.users.isSystemUserCached(input.userId)) return;
    const category = NOTIFICATION_CATEGORY_OF[input.type];
    const target = exec ?? this.core.db;
    const res = await target.execute(
      'INSERT INTO notifications (user_id, type, category, title, body, data) VALUES (?, ?, ?, ?, ?, ?)',
      [input.userId, input.type, category, input.title.slice(0, 200), input.body.slice(0, 1000), input.data ? JSON.stringify(input.data) : null],
    );
    const dto: NotificationDto = {
      id: res.insertId,
      type: input.type,
      category,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
      read: false,
      createdAt: Date.now(),
    };
    const fanout = async () => {
      this.core.bus.ws(userChannel(input.userId, 'notifications'), 'notification', dto);
      try {
        const p = await this.profile(input.userId);
        const prefs = p.prefs[category];
        const forced = category === 'SECURITY';
        if ((forced || prefs.EMAIL) && p.email && !p.email.endsWith('@system.gocrypto')) {
          await this.core.queues.email({
            to: p.email,
            subject: `GoCrypto: ${input.title}`,
            template: 'notification',
            vars: { body: input.body },
            antiPhishingCode: p.antiPhishing,
          });
        }
        if (forced || prefs.PUSH) {
          await this.core.queues.push({ userId: input.userId, title: input.title, body: input.body, data: { type: input.type, ...input.data } });
        }
      } catch (e) {
        getLogger().warn({ err: e, userId: input.userId }, 'notification fan-out failed');
      }
    };
    if (exec?.afterCommit) exec.afterCommit(fanout);
    else await fanout();
  }

  async list(userId: string, q: { cursor?: string; limit: number; unreadOnly?: boolean }) {
    const where = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (q.cursor) {
      where.push('id < ?');
      params.push(q.cursor);
    }
    if (q.unreadOnly) where.push('read_at IS NULL');
    params.push(q.limit + 1);
    const rows = await this.core.db.query<Record<string, unknown>>(
      `SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      params,
    );
    const page = rows.slice(0, q.limit);
    return {
      items: page.map(
        (r): NotificationDto => ({
          id: String(r.id),
          type: r.type as NotificationType,
          category: r.category as NotificationDto['category'],
          title: String(r.title),
          body: String(r.body),
          data: parseJson<Record<string, unknown> | null>(r.data, null),
          read: r.read_at != null,
          createdAt: toMsStrict(r.created_at),
        }),
      ),
      nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
    return Number(r?.c ?? 0);
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const r = await this.core.db.execute(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ? AND read_at IS NULL',
      [id, userId],
    );
    return r.affectedRows === 1;
  }

  async markAllRead(userId: string): Promise<number> {
    const r = await this.core.db.execute('UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND read_at IS NULL', [userId]);
    return r.affectedRows;
  }
}
