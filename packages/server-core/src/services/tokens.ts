import type { AuthTokens, UserRole } from '@gocrypto/shared-types';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import type { Core } from '../core';
import { uuid } from '../crypto';
import { AppError } from '../errors';
import { key } from '../redis';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  role: UserRole;
}

const enc = new TextEncoder();

/** JWT issuance/verification. Access tokens are short-lived; refresh tokens rotate on every use. */
export class TokenService {
  private readonly accessKey: Uint8Array;
  private readonly refreshKey: Uint8Array;

  constructor(private readonly core: Core) {
    this.accessKey = enc.encode(core.config.JWT_SECRET);
    this.refreshKey = enc.encode(core.config.JWT_REFRESH_SECRET);
  }

  private mapError(e: unknown): AppError {
    if (e instanceof joseErrors.JWTExpired) return new AppError('TOKEN_EXPIRED', 'Token expired');
    return new AppError('TOKEN_INVALID', 'Invalid token');
  }

  async signAccess(userId: string, sessionId: string, role: UserRole): Promise<{ token: string; expiresAt: number }> {
    const ttl = this.core.config.JWT_ACCESS_TTL_SEC;
    const expiresAt = Date.now() + ttl * 1000;
    const token = await new SignJWT({ sid: sessionId, role, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.core.config.JWT_ISSUER)
      .setAudience(this.core.config.JWT_AUDIENCE)
      .setIssuedAt()
      .setJti(uuid())
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(this.accessKey);
    return { token, expiresAt };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, {
        issuer: this.core.config.JWT_ISSUER,
        audience: this.core.config.JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access' || !payload.sub || typeof payload.sid !== 'string') throw new AppError('TOKEN_INVALID', 'Invalid token');
      if (await this.isSessionRevoked(payload.sid)) throw new AppError('TOKEN_REVOKED', 'Session has been revoked');
      return { userId: payload.sub, sessionId: payload.sid, role: payload.role as UserRole };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw this.mapError(e);
    }
  }

  async signRefresh(userId: string, sessionId: string, jti: string, expiresAt: number): Promise<string> {
    return new SignJWT({ sid: sessionId, typ: 'refresh' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.core.config.JWT_ISSUER)
      .setIssuedAt()
      .setJti(jti)
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(this.refreshKey);
  }

  async verifyRefresh(token: string): Promise<{ userId: string; sessionId: string; jti: string }> {
    try {
      const { payload } = await jwtVerify(token, this.refreshKey, { issuer: this.core.config.JWT_ISSUER, algorithms: ['HS256'] });
      if (payload.typ !== 'refresh' || !payload.sub || typeof payload.sid !== 'string' || !payload.jti) {
        throw new AppError('TOKEN_INVALID', 'Invalid refresh token');
      }
      return { userId: payload.sub, sessionId: payload.sid, jti: payload.jti };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw this.mapError(e);
    }
  }

  /** Short-lived token proving the password step of a 2FA login. */
  async signMfa(userId: string, fingerprint: string): Promise<string> {
    return new SignJWT({ typ: 'mfa', fp: fingerprint })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(this.core.config.JWT_ISSUER)
      .setIssuedAt()
      .setJti(uuid())
      .setExpirationTime('5m')
      .sign(this.accessKey);
  }

  async verifyMfa(token: string): Promise<{ userId: string; fingerprint: string; jti: string }> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, { issuer: this.core.config.JWT_ISSUER, algorithms: ['HS256'] });
      if (payload.typ !== 'mfa' || !payload.sub || !payload.jti) throw new AppError('TOKEN_INVALID', 'Invalid MFA token');
      return { userId: payload.sub, fingerprint: String(payload.fp ?? ''), jti: payload.jti };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw this.mapError(e);
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return (await this.core.redis.main.exists(key('sess', 'revoked', sessionId))) === 1;
  }

  /** Make outstanding access tokens of a session unusable immediately. */
  async markRevoked(sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;
    const pipe = this.core.redis.main.pipeline();
    for (const sid of sessionIds) pipe.set(key('sess', 'revoked', sid), '1', 'EX', this.core.config.JWT_ACCESS_TTL_SEC + 60);
    await pipe.exec();
  }

  async issuePair(userId: string, sessionId: string, role: UserRole, refreshJti: string, refreshExpiresAt: number): Promise<AuthTokens> {
    const access = await this.signAccess(userId, sessionId, role);
    const refreshToken = await this.signRefresh(userId, sessionId, refreshJti, refreshExpiresAt);
    return {
      accessToken: access.token,
      refreshToken,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
      sessionId,
    };
  }
}
