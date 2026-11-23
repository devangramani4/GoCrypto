import { AppError } from '@gocrypto/server-core';
import type { NotificationPrefs, UserSettingsDto } from '@gocrypto/shared-types';
import { createApiKeySchema, updateProfileSchema, userSettingsSchema } from '@gocrypto/validation';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DEFAULT_NOTIFICATION_PREFS, parseJson } from '@gocrypto/server-core';
import type { ApiDeps } from '../deps';
import { authenticated, requireSession, requireUser } from '../plugins/auth';

export async function userRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/me', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => {
    const user = await core.users.requireById(requireUser(req).userId);
    return core.users.toDto(user);
  });

  r.patch('/me', { schema: { body: updateProfileSchema }, preHandler: authenticated }, async (req) => {
    const { userId } = requireSession(req);
    const b = req.body;
    if (b.displayName || b.locale) {
      await core.db.execute('UPDATE users SET display_name = COALESCE(?, display_name), locale = COALESCE(?, locale) WHERE id = ?', [
        b.displayName ?? null,
        b.locale ?? null,
        userId,
      ]);
    }
    if (b.antiPhishingCode) {
      await core.db.execute('UPDATE user_security SET anti_phishing_code = ? WHERE user_id = ?', [b.antiPhishingCode, userId]);
      await core.audit.log({ actorUserId: userId, actorType: 'USER', action: 'security.anti_phishing_set', ip: req.ip });
      core.notifications.invalidate(userId);
    }
    core.users.invalidate(userId);
    return core.users.toDto(await core.users.requireById(userId));
  });

  const loadSettings = async (userId: string): Promise<UserSettingsDto> => {
    const row = await core.db.one<{ notification_prefs: unknown; theme: string; confirm_orders: boolean }>(
      'SELECT notification_prefs, theme, confirm_orders FROM user_settings WHERE user_id = ?',
      [userId],
    );
    const user = await core.users.requireById(userId);
    const stored = parseJson<Partial<NotificationPrefs>>(row?.notification_prefs, {});
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS };
    for (const k of Object.keys(prefs) as (keyof NotificationPrefs)[]) prefs[k] = { ...prefs[k], ...(stored[k] ?? {}) };
    return { notificationPrefs: prefs, locale: user.locale, theme: (row?.theme as UserSettingsDto['theme']) ?? 'dark', confirmOrders: row?.confirm_orders ?? true };
  };

  r.get('/me/settings', { preHandler: authenticated }, async (req) => loadSettings(requireUser(req).userId));

  r.put('/me/settings', { schema: { body: userSettingsSchema }, preHandler: authenticated }, async (req) => {
    const { userId } = requireSession(req);
    const current = await loadSettings(userId);
    const prefs = { ...current.notificationPrefs };
    for (const [cat, channels] of Object.entries(req.body.notificationPrefs ?? {})) {
      const k = cat as keyof NotificationPrefs;
      prefs[k] = { ...prefs[k], ...(channels ?? {}) };
    }
    // Security notifications cannot be disabled.
    prefs.SECURITY = { IN_APP: true, EMAIL: true, PUSH: prefs.SECURITY.PUSH };
    await core.db.execute(
      `INSERT INTO user_settings (user_id, notification_prefs, theme, confirm_orders) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notification_prefs = VALUES(notification_prefs), theme = VALUES(theme), confirm_orders = VALUES(confirm_orders)`,
      [userId, JSON.stringify(prefs), req.body.theme ?? current.theme, (req.body.confirmOrders ?? current.confirmOrders) ? 1 : 0],
    );
    if (req.body.locale) await core.db.execute('UPDATE users SET locale = ? WHERE id = ?', [req.body.locale, userId]);
    core.notifications.invalidate(userId);
    return loadSettings(userId);
  });

  r.get('/me/api-keys', { preHandler: authenticated }, async (req) => core.apiKeys.list(requireSession(req).userId));

  r.post('/me/api-keys', { schema: { body: createApiKeySchema }, preHandler: authenticated }, async (req, reply) => {
    const { userId } = requireSession(req);
    const sec = await core.auth.security(userId);
    if (sec.totp_enabled) {
      if (!req.body.totpCode) throw new AppError('MFA_REQUIRED', '2FA code required to create API keys');
      await core.auth.verifyTotpFor(userId, req.body.totpCode);
    }
    return reply.status(201).send(await core.apiKeys.create(userId, req.body));
  });

  r.delete('/me/api-keys/:id', { schema: { params: z.object({ id: z.string().regex(/^\d+$/) }) }, preHandler: authenticated }, async (req, reply) => {
    await core.apiKeys.revoke(requireSession(req).userId, req.params.id);
    return reply.status(204).send();
  });
}
