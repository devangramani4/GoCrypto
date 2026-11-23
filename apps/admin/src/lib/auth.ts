import type { GoCryptoClient } from '@gocrypto/api-client';
import { isForbidden } from './errors';
import { type AdminIdentity, toAdminIdentity } from './session';

export const NOT_STAFF_MESSAGE = 'This account does not have back-office access. Sign in with a staff account.';

export class NotStaffError extends Error {
  constructor() {
    super(NOT_STAFF_MESSAGE);
    this.name = 'NotStaffError';
  }
}

/** Log out, ignoring transport errors (the client always drops its in-memory tokens). */
export async function safeLogout(client: GoCryptoClient): Promise<void> {
  try {
    await client.auth.logout();
  } catch {
    /* session already gone or server unreachable: local tokens are cleared regardless */
  }
}

/**
 * Resolve the staff identity of the signed-in account. A 403 means the account is not staff:
 * the session is revoked immediately so a non-staff token never lingers in the console.
 */
export async function verifyStaffAccess(client: GoCryptoClient): Promise<AdminIdentity> {
  try {
    return toAdminIdentity(await client.admin.me());
  } catch (e) {
    if (isForbidden(e)) {
      await safeLogout(client);
      throw new NotStaffError();
    }
    throw e;
  }
}

const inFlight = new WeakMap<GoCryptoClient, Promise<AdminIdentity | null>>();

/**
 * Resume a session from the httpOnly refresh cookie. Single-flight per client so StrictMode's
 * double effect invocation (or a fast remount) never rotates the refresh token twice.
 */
export function restoreSession(client: GoCryptoClient): Promise<AdminIdentity | null> {
  const existing = inFlight.get(client);
  if (existing) return existing;
  const p = (async () => {
    const tokens = await client.auth.restore();
    if (!tokens) return null;
    try {
      return await verifyStaffAccess(client);
    } catch (e) {
      // Do not keep an unverified access token in memory.
      if (!(e instanceof NotStaffError)) await client.http.setTokens(null);
      throw e;
    }
  })();
  inFlight.set(client, p);
  p.finally(() => inFlight.delete(client)).catch(() => undefined);
  return p;
}
