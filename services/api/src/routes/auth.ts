import { AppError } from '@gocrypto/server-core';
import {
  appleAuthSchema,
  changePasswordSchema,
  changePinSchema,
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginMfaSchema,
  loginSchema,
  logoutSchema,
  pushTokenSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  sendPhoneOtpSchema,
  setPinSchema,
  updateDeviceSchema,
  verifyEmailSchema,
  verifyPhoneSchema,
  verifyPinSchema,
} from '@gocrypto/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthTokens, LoginResult } from '@gocrypto/shared-types';
import type { ApiDeps } from '../deps';
import { authenticated, requireSession, requireUser } from '../plugins/auth';
import { requestContext } from '../util/context';

const REFRESH_COOKIE = 'gc_rt';
/** Non-secret, JS-readable flag so the web app only attempts a cookie refresh when one can succeed. */
const SESSION_HINT_COOKIE = 'gc_has_session';

function clearWebSession(reply: FastifyReply): void {
  void reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  void reply.clearCookie(SESSION_HINT_COOKIE, { path: '/' });
}
const idParam = z.object({ id: z.string().min(1).max(64) });

/** Web clients (X-GC-Client: web) receive the refresh token in an httpOnly SameSite=Strict cookie. */
function deliverTokens(req: FastifyRequest, reply: FastifyReply, tokens: AuthTokens, secure: boolean): AuthTokens {
  if (req.headers['x-gc-client'] !== 'web') return tokens;
  const expires = new Date(tokens.refreshTokenExpiresAt);
  void reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/api/v1/auth',
    expires,
  });
  void reply.setCookie(SESSION_HINT_COOKIE, '1', { httpOnly: false, sameSite: 'strict', secure, path: '/', expires });
  return { ...tokens, refreshToken: '' };
}

function deliverLogin(req: FastifyRequest, reply: FastifyReply, result: LoginResult, secure: boolean): LoginResult {
  return result.status === 'OK' ? { ...result, tokens: deliverTokens(req, reply, result.tokens, secure) } : result;
}

export async function authRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const secure = core.config.isProduction;
  const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  r.post('/register', { schema: { body: registerSchema, tags: ['auth'] }, config: strict }, async (req, reply) => {
    const res = await core.auth.register(req.body, requestContext(req));
    return reply.status(201).send({ user: res.user, tokens: deliverTokens(req, reply, res.tokens, secure) });
  });

  r.post('/login', { schema: { body: loginSchema, tags: ['auth'] }, config: strict }, async (req, reply) => {
    return deliverLogin(
      req,
      reply,
      await core.auth.login(req.body, {
        ...requestContext(req),
        deviceId: req.body.deviceId ?? requestContext(req).deviceId,
      }),
      secure,
    );
  });

  r.post('/login/2fa', { schema: { body: loginMfaSchema, tags: ['auth'] }, config: strict }, async (req, reply) => {
    return deliverLogin(req, reply, await core.auth.loginMfa(req.body, requestContext(req)), secure);
  });

  r.post(
    '/refresh',
    {
      schema: { body: refreshSchema.partial(), tags: ['auth'] },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      let token = req.body?.refreshToken;
      if (!token) {
        // Cookie-based refresh requires a custom header (blocks cross-site form posts / CSRF).
        if (req.headers['x-gc-client'] !== 'web') throw new AppError('UNAUTHORIZED', 'Refresh token required');
        token = req.cookies[REFRESH_COOKIE];
        if (!token) {
          clearWebSession(reply);
          throw new AppError('UNAUTHORIZED', 'Refresh token required');
        }
      }
      try {
        return deliverTokens(req, reply, await core.auth.refresh(token, requestContext(req)), secure);
      } catch (e) {
        if (req.headers['x-gc-client'] === 'web') clearWebSession(reply);
        throw e;
      }
    },
  );

  r.post(
    '/logout',
    { schema: { body: logoutSchema.optional(), tags: ['auth'] }, preHandler: authenticated },
    async (req, reply) => {
      const a = requireSession(req);
      await core.auth.logout(a.userId, a.sessionId);
      clearWebSession(reply);
      return reply.status(204).send();
    },
  );

  r.post('/email/send-verification', { preHandler: authenticated, config: strict }, async (req, reply) => {
    await core.auth.sendEmailVerification(requireUser(req).userId);
    return reply.status(202).send({ ok: true });
  });

  r.post(
    '/email/verify',
    { schema: { body: verifyEmailSchema }, preHandler: authenticated, config: strict },
    async (req) => {
      await core.auth.verifyEmail(requireUser(req).userId, req.body.code);
      return { ok: true };
    },
  );

  r.post(
    '/phone/send-otp',
    { schema: { body: sendPhoneOtpSchema }, preHandler: authenticated, config: strict },
    async (req, reply) => {
      await core.auth.sendPhoneOtp(requireUser(req).userId, req.body.phone);
      return reply.status(202).send({ ok: true });
    },
  );

  r.post(
    '/phone/verify',
    { schema: { body: verifyPhoneSchema }, preHandler: authenticated, config: strict },
    async (req) => {
      await core.auth.verifyPhone(requireUser(req).userId, req.body.phone, req.body.code);
      return { ok: true };
    },
  );

  r.post(
    '/password/forgot',
    { schema: { body: forgotPasswordSchema }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      await core.auth.forgotPassword(req.body.email, requestContext(req));
      return reply.status(202).send({ ok: true });
    },
  );

  r.post('/password/reset', { schema: { body: resetPasswordSchema }, config: strict }, async (req) => {
    await core.auth.resetPassword(req.body.email, req.body.code, req.body.newPassword, requestContext(req));
    return { ok: true };
  });

  r.post(
    '/password/change',
    { schema: { body: changePasswordSchema }, preHandler: authenticated, config: strict },
    async (req) => {
      const a = requireSession(req);
      await core.auth.changePassword(a.userId, a.sessionId, req.body, requestContext(req));
      return { ok: true };
    },
  );

  r.post('/oauth/google', { schema: { body: googleAuthSchema }, config: strict }, async (req, reply) => {
    return deliverLogin(req, reply, await core.auth.oauthGoogle(req.body.idToken, requestContext(req)), secure);
  });

  r.post('/oauth/apple', { schema: { body: appleAuthSchema }, config: strict }, async (req, reply) => {
    return deliverLogin(
      req,
      reply,
      await core.auth.oauthApple(req.body.identityToken, req.body.nonce, req.body.fullName, requestContext(req)),
      secure,
    );
  });

  r.post('/2fa/setup', { preHandler: authenticated }, async (req) => core.auth.setupTotp(requireSession(req).userId));

  r.post(
    '/2fa/enable',
    { schema: { body: enableTwoFactorSchema }, preHandler: authenticated, config: strict },
    async (req) => core.auth.enableTotp(requireSession(req).userId, req.body.code, requestContext(req)),
  );

  r.post(
    '/2fa/disable',
    { schema: { body: disableTwoFactorSchema }, preHandler: authenticated, config: strict },
    async (req) => {
      await core.auth.disableTotp(requireSession(req).userId, req.body.code, req.body.password, requestContext(req));
      return { ok: true };
    },
  );

  r.post('/pin', { schema: { body: setPinSchema }, preHandler: authenticated, config: strict }, async (req) => {
    await core.auth.setPin(requireSession(req).userId, req.body.pin, req.body.password, requestContext(req));
    return { ok: true };
  });

  r.put('/pin', { schema: { body: changePinSchema }, preHandler: authenticated, config: strict }, async (req) => {
    await core.auth.changePin(requireSession(req).userId, req.body.currentPin, req.body.newPin, requestContext(req));
    return { ok: true };
  });

  r.post(
    '/pin/verify',
    { schema: { body: verifyPinSchema }, preHandler: authenticated, config: strict },
    async (req) => {
      await core.auth.verifyPin(requireSession(req).userId, req.body.pin);
      return { ok: true };
    },
  );

  r.get('/security', { preHandler: authenticated }, async (req) =>
    core.auth.securityOverview(requireSession(req).userId),
  );

  r.get('/sessions', { preHandler: authenticated }, async (req) => {
    const a = requireSession(req);
    return core.auth.sessions(a.userId, a.sessionId);
  });

  r.delete('/sessions/:id', { schema: { params: idParam }, preHandler: authenticated }, async (req, reply) => {
    const a = requireSession(req);
    const n = await core.auth.revokeSessions(a.userId, [req.params.id], 'USER_REVOKED');
    if (!n) throw new AppError('NOT_FOUND', 'Session not found');
    return reply.status(204).send();
  });

  r.delete('/sessions', { preHandler: authenticated }, async (req) => {
    const a = requireSession(req);
    return { revoked: await core.auth.revokeSessions(a.userId, 'ALL', 'USER_REVOKED_OTHERS', a.sessionId) };
  });

  r.get('/devices', { preHandler: authenticated }, async (req) =>
    core.auth.devices(requireSession(req).userId, requestContext(req).deviceId),
  );

  r.patch(
    '/devices/:id',
    { schema: { params: idParam, body: updateDeviceSchema }, preHandler: authenticated },
    async (req) => {
      await core.auth.updateDevice(requireSession(req).userId, req.params.id, req.body);
      return { ok: true };
    },
  );

  r.delete('/devices/:id', { schema: { params: idParam }, preHandler: authenticated }, async (req, reply) => {
    await core.auth.removeDevice(requireSession(req).userId, req.params.id);
    return reply.status(204).send();
  });

  r.post('/devices/push-token', { schema: { body: pushTokenSchema }, preHandler: authenticated }, async (req) => {
    await core.auth.registerPushToken(
      requireSession(req).userId,
      requestContext(req),
      req.body.token,
      req.body.provider,
    );
    return { ok: true };
  });

  r.delete('/devices/push-token', { preHandler: authenticated }, async (req) => {
    await core.auth.unregisterPushToken(requireSession(req).userId, requestContext(req));
    return { ok: true };
  });

  r.get(
    '/login-history',
    {
      schema: {
        querystring: z.object({
          cursor: z.string().regex(/^\d+$/).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
      preHandler: authenticated,
    },
    async (req) => core.auth.loginHistory(requireSession(req).userId, req.query.limit, req.query.cursor),
  );
}
