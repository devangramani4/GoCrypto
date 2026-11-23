import { currentTotpStep, totpAt } from '@gocrypto/server-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, api, createUser, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe('registration & login', () => {
  it('registers, hashes the password and returns a token pair', async () => {
    const res = await api(h, 'POST', '/api/v1/auth/register', {
      body: { email: 'New.User@Example.com', password: 'Str0ngPassword!', acceptTerms: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe('new.user@example.com');
    expect(body.user.emailVerified).toBe(false);
    expect(body.tokens.accessToken).toBeTruthy();
    const row = await h.core.db.one<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = ?', ['new.user@example.com']);
    expect(row!.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row!.password_hash).not.toContain('Str0ngPassword!');
    const me = await api(h, 'GET', '/api/v1/users/me', { token: body.tokens.accessToken });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('new.user@example.com');
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const dup = await api(h, 'POST', '/api/v1/auth/register', {
      body: { email: 'new.user@example.com', password: 'Str0ngPassword!', acceptTerms: true },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('EMAIL_TAKEN');
    const weak = await api(h, 'POST', '/api/v1/auth/register', { body: { email: 'weak@example.com', password: 'short', acceptTerms: true } });
    expect(weak.statusCode).toBe(400);
  });

  it('does not reveal whether an email exists and locks after repeated failures', async () => {
    const u = await createUser(h);
    const unknown = await api(h, 'POST', '/api/v1/auth/login', { body: { email: 'nobody@example.com', password: 'whatever' } });
    expect(unknown.json().error.code).toBe('INVALID_CREDENTIALS');
    for (let i = 0; i < 5; i++) {
      const r = await api(h, 'POST', '/api/v1/auth/login', { body: { email: u.email, password: 'wrong-password' } });
      expect(r.json().error.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await api(h, 'POST', '/api/v1/auth/login', { body: { email: u.email, password: u.password } });
    expect(locked.json().error.code).toBe('ACCOUNT_LOCKED');
    const history = await h.core.db.one<{ c: number }>('SELECT COUNT(*) AS c FROM login_history WHERE user_id = ? AND success = 0', [u.id]);
    expect(Number(history!.c)).toBeGreaterThanOrEqual(6);
  });
});

describe('refresh token rotation', () => {
  it('rotates refresh tokens and revokes the session on reuse', async () => {
    const u = await createUser(h);
    const r1 = await api(h, 'POST', '/api/v1/auth/refresh', { body: { refreshToken: u.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const rotated = r1.json();
    expect(rotated.refreshToken).not.toBe(u.refreshToken);
    // Second rotation with the new token works.
    const r2 = await api(h, 'POST', '/api/v1/auth/refresh', { body: { refreshToken: rotated.refreshToken } });
    expect(r2.statusCode).toBe(200);
    // Replaying the very first token (outside the grace window semantics: it is two rotations old).
    const replay = await api(h, 'POST', '/api/v1/auth/refresh', { body: { refreshToken: u.refreshToken } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('REFRESH_TOKEN_REUSED');
    // The whole session is now revoked: access tokens stop working immediately.
    const me = await api(h, 'GET', '/api/v1/users/me', { token: r2.json().accessToken });
    expect(me.statusCode).toBe(401);
    const alert = await h.core.db.one<{ c: number }>("SELECT COUNT(*) AS c FROM security_alerts WHERE user_id = ? AND type = 'REFRESH_TOKEN_REUSE'", [u.id]);
    expect(Number(alert!.c)).toBe(1);
  });

  it('logs out and revokes access immediately', async () => {
    const u = await createUser(h);
    const out = await api(h, 'POST', '/api/v1/auth/logout', { token: u.token, body: {} });
    expect(out.statusCode).toBe(204);
    expect((await api(h, 'GET', '/api/v1/users/me', { token: u.token })).statusCode).toBe(401);
  });
});

describe('two-factor authentication', () => {
  it('enables TOTP, requires it at login and rejects replayed codes', async () => {
    const u = await createUser(h);
    const setup = (await api(h, 'POST', '/api/v1/auth/2fa/setup', { token: u.token })).json();
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    const enable = await api(h, 'POST', '/api/v1/auth/2fa/enable', { token: u.token, body: { code: totpAt(setup.secret, currentTotpStep()) } });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().backupCodes).toHaveLength(10);

    const login = (await api(h, 'POST', '/api/v1/auth/login', { body: { email: u.email, password: u.password } })).json();
    expect(login.status).toBe('MFA_REQUIRED');
    // The code used to enable 2FA cannot be replayed.
    const replay = await api(h, 'POST', '/api/v1/auth/login/2fa', { body: { mfaToken: login.mfaToken, code: totpAt(setup.secret, currentTotpStep()) } });
    expect(replay.json().error.code).toBe('INVALID_MFA_CODE');
    // A backup code works exactly once.
    const backup = enable.json().backupCodes[0];
    const ok = await api(h, 'POST', '/api/v1/auth/login/2fa', { body: { mfaToken: login.mfaToken, backupCode: backup } });
    expect(ok.json().status).toBe('OK');
    const login2 = (await api(h, 'POST', '/api/v1/auth/login', { body: { email: u.email, password: u.password } })).json();
    const again = await api(h, 'POST', '/api/v1/auth/login/2fa', { body: { mfaToken: login2.mfaToken, backupCode: backup } });
    expect(again.json().error.code).toBe('INVALID_MFA_CODE');
    // Secrets are encrypted at rest.
    const sec = await h.core.db.one<{ totp_secret_enc: string }>('SELECT totp_secret_enc FROM user_security WHERE user_id = ?', [u.id]);
    expect(sec!.totp_secret_enc.startsWith('v1:')).toBe(true);
    expect(sec!.totp_secret_enc).not.toContain(setup.secret);
  });
});

describe('trading PIN', () => {
  it('sets a PIN and locks after repeated wrong attempts', async () => {
    const u = await createUser(h);
    expect((await api(h, 'POST', '/api/v1/auth/pin', { token: u.token, body: { pin: '480913', password: u.password } })).statusCode).toBe(200);
    expect((await api(h, 'POST', '/api/v1/auth/pin/verify', { token: u.token, body: { pin: '480913' } })).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) {
      const r = await api(h, 'POST', '/api/v1/auth/pin/verify', { token: u.token, body: { pin: '000001' } });
      expect(r.json().error.code).toBe('INVALID_PIN');
    }
    const locked = await api(h, 'POST', '/api/v1/auth/pin/verify', { token: u.token, body: { pin: '480913' } });
    expect(locked.json().error.code).toBe('PIN_LOCKED');
  });
});

describe('password change, sessions and devices', () => {
  it('revokes other sessions on password change and locks withdrawals', async () => {
    const u = await createUser(h);
    const other = (await api(h, 'POST', '/api/v1/auth/login', { body: { email: u.email, password: u.password }, headers: { 'x-device-id': 'other-device-99' } })).json();
    const sessions = (await api(h, 'GET', '/api/v1/auth/sessions', { token: u.token })).json();
    expect(sessions.length).toBe(2);
    const change = await api(h, 'POST', '/api/v1/auth/password/change', {
      token: u.token,
      body: { currentPassword: u.password, newPassword: 'An0therStrongPass!' },
    });
    expect(change.statusCode).toBe(200);
    expect((await api(h, 'GET', '/api/v1/users/me', { token: other.tokens.accessToken })).statusCode).toBe(401);
    expect((await api(h, 'GET', '/api/v1/users/me', { token: u.token })).statusCode).toBe(200);
    const sec = (await api(h, 'GET', '/api/v1/auth/security', { token: u.token })).json();
    expect(sec.withdrawalLockUntil).toBeGreaterThan(Date.now());
    const devices = (await api(h, 'GET', '/api/v1/auth/devices', { token: u.token })).json();
    expect(devices.length).toBe(2);
  });
});

describe('API keys and RBAC', () => {
  it('authenticates HMAC-signed requests and enforces key permissions', async () => {
    const u = await createUser(h, [['SPOT', 'USDT', '1000']]);
    const key = (await api(h, 'POST', '/api/v1/users/me/api-keys', { token: u.token, body: { label: 'bot', permissions: ['READ'] } })).json();
    expect(key.secret).toBeTruthy();
    const { createHmac } = await import('node:crypto');
    const sign = (method: string, path: string, body = '') => {
      const ts = String(Date.now());
      return { 'x-gc-apikey': key.keyId, 'x-gc-timestamp': ts, 'x-gc-signature': createHmac('sha256', key.secret).update(`${ts}${method}${path}${body}`).digest('hex') };
    };
    const ok = await api(h, 'GET', '/api/v1/wallet/balances', { headers: sign('GET', '/api/v1/wallet/balances') });
    expect(ok.statusCode).toBe(200);
    // Same signature replayed is rejected.
    const hdr = sign('GET', '/api/v1/users/me');
    expect((await api(h, 'GET', '/api/v1/users/me', { headers: hdr })).statusCode).toBe(200);
    expect((await api(h, 'GET', '/api/v1/users/me', { headers: hdr })).json().error.code).toBe('SIGNATURE_INVALID');
    // READ keys cannot trade.
    const body = JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '100', quantity: '0.1' });
    const trade = await h.app.inject({
      method: 'POST',
      url: '/api/v1/spot/orders',
      headers: { 'content-type': 'application/json', ...sign('POST', '/api/v1/spot/orders', body) },
      payload: body,
    });
    expect(trade.statusCode).toBe(403);
    // Tampered signature.
    const bad = await api(h, 'GET', '/api/v1/wallet/balances', { headers: { ...sign('GET', '/api/v1/wallet/balances'), 'x-gc-signature': 'deadbeef' } });
    expect(bad.json().error.code).toBe('SIGNATURE_INVALID');
  });

  it('keeps users out of the admin API and enforces per-permission access', async () => {
    const user = await createUser(h);
    expect((await api(h, 'GET', '/api/v1/admin/dashboard', { token: user.token })).statusCode).toBe(403);
    const support = await createUser(h, [], { role: 'SUPPORT' });
    expect((await api(h, 'GET', '/api/v1/admin/users', { token: support.token })).statusCode).toBe(200);
    expect((await api(h, 'PUT', '/api/v1/admin/fees', { token: support.token, body: { fees: [{ marketType: 'SPOT', vipTier: 0, makerRate: '0.001', takerRate: '0.001' }] } })).statusCode).toBe(403);
    const admin = (await api(h, 'POST', '/api/v1/auth/login', { body: { email: 'admin@gocrypto.local', password: 'AdminPassw0rd!2026' } })).json();
    const dash = await api(h, 'GET', '/api/v1/admin/dashboard', { token: admin.tokens.accessToken });
    expect(dash.statusCode).toBe(200);
    const freeze = await api(h, 'POST', `/api/v1/admin/users/${user.id}/freeze`, { token: admin.tokens.accessToken, body: { reason: 'compliance review' } });
    expect(freeze.statusCode).toBe(200);
    const order = await api(h, 'POST', '/api/v1/spot/orders', { token: user.token, body: { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '100', quantity: '0.1' } });
    expect(order.statusCode).toBe(401); // sessions revoked on freeze
    const audit = await h.core.db.one<{ c: number }>("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'admin.user.freeze' AND target_id = ?", [user.id]);
    expect(Number(audit!.c)).toBe(1);
  });
});
