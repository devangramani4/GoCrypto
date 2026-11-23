import { renderMetrics } from '@gocrypto/server-core';
import { AppError } from '@gocrypto/server-core';
import { idString } from '@gocrypto/validation';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps';
import { authenticated, requireUser } from '../plugins/auth';

export async function assetRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/', { config: { apiKey: 'READ' } }, async (_req, reply) => {
    void reply.header('cache-control', 'public, max-age=5');
    const prices = await core.prices.usdPrices();
    return core.assets.list().filter((a) => a.isActive).map((a) => core.assets.toDto(a, prices.get(a.symbol) ?? null));
  });
  r.get('/:symbol', { schema: { params: z.object({ symbol: z.string().regex(/^[A-Z0-9]{2,16}$/) }) }, config: { apiKey: 'READ' } }, async (req) => {
    const a = core.assets.require(req.params.symbol);
    return core.assets.toDto(a, await core.prices.usdPrice(a.symbol));
  });
}

export async function portfolioRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/summary', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.portfolio.summary(requireUser(req).userId));
  r.get('/allocation', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.portfolio.allocation(requireUser(req).userId));
  r.get('/holdings', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.portfolio.holdings(requireUser(req).userId));
  r.get(
    '/performance',
    { schema: { querystring: z.object({ range: z.enum(['24h', '7d', '30d', '90d', '1y']).default('30d') }) }, preHandler: authenticated, config: { apiKey: 'READ' } },
    async (req) => core.portfolio.performance(requireUser(req).userId, req.query.range),
  );
  r.get('/positions', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => {
    const { userId } = requireUser(req);
    return { futures: await core.futures.positionDtos(userId), options: await core.options.positionDtos(userId) };
  });
}

export async function notificationRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    '/',
    {
      schema: {
        querystring: z.object({
          cursor: z.string().regex(/^\d+$/).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
          unread: z.enum(['true', 'false']).optional(),
        }),
      },
      preHandler: authenticated,
    },
    async (req) => core.notifications.list(requireUser(req).userId, { ...req.query, unreadOnly: req.query.unread === 'true' }),
  );
  r.get('/unread-count', { preHandler: authenticated }, async (req) => ({ count: await core.notifications.unreadCount(requireUser(req).userId) }));
  r.post('/:id/read', { schema: { params: z.object({ id: idString }) }, preHandler: authenticated }, async (req) => {
    const ok = await core.notifications.markRead(requireUser(req).userId, req.params.id);
    if (!ok) throw new AppError('NOT_FOUND', 'Notification not found or already read');
    return { ok: true };
  });
  r.post('/read-all', { preHandler: authenticated }, async (req) => ({ updated: await core.notifications.markAllRead(requireUser(req).userId) }));
}

export async function healthRoutes(app: FastifyInstance, { core, runner }: ApiDeps): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok', service: 'api', mode: core.config.TRADING_MODE, ts: Date.now() }));
  // Public, cacheable platform status for clients (sandbox banner, server clock offset).
  app.get('/api/v1/system/status', { config: { rateLimit: false } }, async () => ({
    mode: core.config.TRADING_MODE,
    serverTime: Date.now(),
    version: process.env.npm_package_version ?? '0.1.0',
    simulatedDeposits: core.config.TRADING_MODE === 'SANDBOX',
  }));
  app.get('/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      const [db, redis] = await Promise.all([core.db.ping(), core.redis.ping()]);
      return { status: 'ready', dbMs: db, redisMs: redis, engine: runner ? runner.stats() : 'external' };
    } catch (e) {
      return reply.status(503).send({ status: 'unavailable', error: (e as Error).message });
    }
  });
  app.get('/metrics', { config: { rateLimit: false } }, async (req, reply) => {
    const token = core.config.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) throw new AppError('UNAUTHORIZED', 'Metrics token required');
    const m = await renderMetrics();
    return reply.header('content-type', m.contentType).send(m.body);
  });
}
