import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getLogger } from '@gocrypto/server-core';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ApiDeps } from './deps';
import { registerAuth } from './plugins/auth';
import { registerErrorHandling } from './plugins/errors';
import { registerGuards } from './plugins/guards';
import { assetRoutes, healthRoutes, notificationRoutes, portfolioRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { marketRoutes } from './routes/markets';
import { futuresRoutes, optionsRoutes, orderRoutes, spotRoutes, tradeRoutes } from './routes/trading';
import { userRoutes } from './routes/users';
import { walletRoutes } from './routes/wallet';

export interface BuildOptions {
  logRequests?: boolean;
  rateLimit?: boolean;
  docs?: boolean;
}

export async function buildApp(deps: ApiDeps, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const { core } = deps;
  const app = Fastify({
    loggerInstance: getLogger().child({ component: 'http' }) as unknown as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: !opts.logRequests }),
    trustProxy: core.config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: core.config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || core.config.CORS_ORIGINS.includes(origin) || (!core.config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
        cb(null, true);
      } else cb(new Error('Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-device-id',
      'x-device-name',
      'x-platform',
      'x-gc-client',
      'x-gc-apikey',
      'x-gc-timestamp',
      'x-gc-signature',
      'x-request-id',
    ],
    maxAge: 600,
  });
  await app.register(cookie, { secret: core.config.JWT_REFRESH_SECRET });
  if (opts.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      max: core.config.RATE_LIMIT_MAX,
      timeWindow: core.config.RATE_LIMIT_WINDOW_MS,
      redis: core.redis.main,
      nameSpace: 'gc:rl:ip:',
      skipOnError: true,
      keyGenerator: (req) => req.ip,
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: 429,
        error: { code: 'RATE_LIMITED', message: `Rate limit exceeded, retry in ${Math.ceil(ctx.ttl / 1000)}s` },
      }),
    });
  }
  if (opts.docs !== false) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'GoCrypto API',
          version: '1.0.0',
          description:
            'Spot, futures and options trading API. Decimal values are strings. Authenticate with `Authorization: Bearer <accessToken>` ' +
            'or HMAC API keys (`X-GC-APIKEY`, `X-GC-TIMESTAMP`, `X-GC-SIGNATURE`).',
        },
        servers: [{ url: core.config.API_PUBLIC_URL }],
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
        security: [{ bearerAuth: [] }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  registerAuth(app, core);
  registerGuards(app, core);

  await app.register((i) => healthRoutes(i, deps));
  const v1 = '/api/v1';
  await app.register((i) => authRoutes(i, deps), { prefix: `${v1}/auth` });
  await app.register((i) => userRoutes(i, deps), { prefix: `${v1}/users` });
  await app.register((i) => assetRoutes(i, deps), { prefix: `${v1}/assets` });
  await app.register((i) => marketRoutes(i, deps), { prefix: `${v1}/markets` });
  await app.register((i) => spotRoutes(i, deps), { prefix: `${v1}/spot` });
  await app.register((i) => orderRoutes(i, deps), { prefix: `${v1}/orders` });
  await app.register((i) => tradeRoutes(i, deps), { prefix: `${v1}/trades` });
  await app.register((i) => futuresRoutes(i, deps), { prefix: `${v1}/futures` });
  await app.register((i) => optionsRoutes(i, deps), { prefix: `${v1}/options` });
  await app.register((i) => walletRoutes(i, deps), { prefix: `${v1}/wallet` });
  await app.register((i) => portfolioRoutes(i, deps), { prefix: `${v1}/portfolio` });
  await app.register((i) => notificationRoutes(i, deps), { prefix: `${v1}/notifications` });
  await app.register((i) => adminRoutes(i, deps), { prefix: `${v1}/admin` });
  return app;
}
