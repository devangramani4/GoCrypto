import type { ApiKeyPermission, Permission, UserRole } from '@gocrypto/shared-types';
import { AppError, type Core } from '@gocrypto/server-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface AuthInfo {
  userId: string;
  sessionId: string | null;
  role: UserRole;
  via: 'jwt' | 'apikey';
  apiKeyPermissions?: ApiKeyPermission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
    rawBody?: string;
  }
  interface FastifyContextConfig {
    /** Permission an API key needs for this route; `false` = API keys not accepted. */
    apiKey?: ApiKeyPermission | false;
    /** Enable Idempotency-Key replay protection. */
    idempotent?: boolean;
    /** Per-user requests per second (order endpoints). */
    userRateLimit?: number;
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Resolve credentials (JWT or signed API key). Leaves req.auth null when none are presented. */
async function resolve(core: Core, req: FastifyRequest): Promise<AuthInfo | null> {
  const token = bearer(req);
  if (token) {
    const claims = await core.auth.tokens.verifyAccess(token);
    const flags = await core.users.flags(claims.userId);
    if (flags.status === 'DISABLED') throw new AppError('ACCOUNT_DISABLED', 'Account disabled');
    // Role is always taken from the database, never from the token.
    return { userId: claims.userId, sessionId: claims.sessionId, role: flags.role, via: 'jwt' };
  }
  const keyId = req.headers['x-gc-apikey'];
  if (typeof keyId === 'string' && keyId) {
    const ts = String(req.headers['x-gc-timestamp'] ?? '');
    const sig = String(req.headers['x-gc-signature'] ?? '');
    const auth = await core.apiKeys.authenticate({
      keyId,
      timestamp: ts,
      signature: sig,
      method: req.method,
      path: req.url,
      body: req.rawBody ?? '',
      ip: req.ip ?? null,
    });
    const flags = await core.users.flags(auth.userId);
    if (flags.status === 'DISABLED') throw new AppError('ACCOUNT_DISABLED', 'Account disabled');
    return { userId: auth.userId, sessionId: null, role: flags.role, via: 'apikey', apiKeyPermissions: auth.permissions };
  }
  return null;
}

export function registerAuth(app: FastifyInstance, core: Core): void {
  app.decorateRequest('auth', null);
  // Keep the raw JSON body for API-key signature verification.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    req.rawBody = text;
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new AppError('BAD_REQUEST', 'Malformed JSON body');
      done(err, undefined);
    }
  });

  app.addHook('preValidation', async (req) => {
    if (bearer(req) || req.headers['x-gc-apikey']) {
      req.auth = await resolve(core, req);
      const cfg = req.routeOptions.config;
      if (req.auth?.via === 'apikey') {
        if (cfg.apiKey === false || cfg.apiKey === undefined) throw new AppError('FORBIDDEN', 'API keys cannot access this endpoint');
        if (!req.auth.apiKeyPermissions?.includes(cfg.apiKey)) throw new AppError('FORBIDDEN', `API key lacks ${cfg.apiKey} permission`);
      }
    }
  });
}

export function requireUser(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw new AppError('UNAUTHORIZED', 'Authentication required');
  return req.auth;
}

/** Session-bound (JWT) user, required for account-security endpoints. */
export function requireSession(req: FastifyRequest): AuthInfo & { sessionId: string } {
  const a = requireUser(req);
  if (a.via !== 'jwt' || !a.sessionId) throw new AppError('FORBIDDEN', 'This action requires an interactive session');
  return a as AuthInfo & { sessionId: string };
}

export const authenticated = async (req: FastifyRequest, _reply: FastifyReply) => {
  requireUser(req);
};

export function permissionGuard(core: Core, permission: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const a = requireSession(req);
    if (a.role === 'USER' || !core.users.hasPermission(a.role, permission)) {
      throw new AppError('FORBIDDEN', `Missing permission: ${permission}`);
    }
  };
}
