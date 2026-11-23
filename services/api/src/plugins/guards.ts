import { AppError, type Core, key, metrics } from '@gocrypto/server-core';
import type { FastifyInstance } from 'fastify';

/**
 * - Idempotency-Key replay for money-moving POSTs (cached response for 24h, 409 while in flight)
 * - Per-user request rate for order endpoints (sliding 1s window in Redis)
 * - Request latency metrics
 */
export function registerGuards(app: FastifyInstance, core: Core): void {
  app.addHook('preHandler', async (req, reply) => {
    const cfg = req.routeOptions.config;
    if (cfg.userRateLimit && req.auth) {
      const k = key('rl', 'user', req.auth.userId, Math.floor(Date.now() / 1000));
      const n = await core.redis.main.incr(k);
      if (n === 1) await core.redis.main.expire(k, 2);
      if (n > cfg.userRateLimit) throw new AppError('RATE_LIMITED', 'Too many order requests, slow down');
    }
    if (cfg.idempotent && req.method === 'POST') {
      const idem = req.headers['idempotency-key'];
      if (typeof idem === 'string' && idem.length >= 8 && idem.length <= 64 && req.auth) {
        const k = key('idem', req.auth.userId, req.routeOptions.url ?? req.url, idem);
        const ok = await core.redis.main.set(k, 'pending', 'EX', 86_400, 'NX');
        if (ok !== 'OK') {
          const cached = await core.redis.main.get(k);
          if (!cached || cached === 'pending') throw new AppError('IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is in progress');
          const { status, body } = JSON.parse(cached) as { status: number; body: unknown };
          void reply.header('idempotent-replay', 'true').status(status).send(body);
          return reply;
        }
        (req as unknown as { idemKey?: string }).idemKey = k;
      }
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const k = (req as unknown as { idemKey?: string }).idemKey;
    if (k && reply.getHeader('idempotent-replay') !== 'true') {
      if (reply.statusCode >= 500 || reply.statusCode === 409) await core.redis.main.del(k);
      else {
        let body: unknown = payload;
        try {
          body = typeof payload === 'string' ? JSON.parse(payload) : payload;
        } catch {
          // non-JSON payloads are cached as text
        }
        await core.redis.main.set(k, JSON.stringify({ status: reply.statusCode, body }), 'EX', 86_400);
      }
    }
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    metrics.httpDuration.observe(
      { method: req.method, route: req.routeOptions.url ?? 'unknown', status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });
}
