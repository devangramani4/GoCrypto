import { GoCryptoClient, MemoryTokenStore, randomId } from '@gocrypto/api-client';

const DEVICE_KEY = 'gc_admin_device_id';
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

let memoryDeviceId: string | null = null;

/**
 * Stable per-browser device id (used by the API for session/device tracking and new-device alerts).
 * Falls back to an in-memory id when storage is unavailable (private mode, blocked site data).
 */
export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;
    const id = `adm-${randomId()}`;
    window.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    memoryDeviceId ??= `adm-${randomId()}`;
    return memoryDeviceId;
  }
}

/**
 * The admin console keeps the access token in memory only; the refresh token lives in the httpOnly
 * `gc_rt` cookie set by the API (`cookieRefresh`), so a reload resumes the session via `auth.restore()`.
 */
export function createAdminClient(opts: { onSessionExpired: () => void }): GoCryptoClient {
  return new GoCryptoClient({
    baseUrl: '',
    tokenStore: new MemoryTokenStore(),
    platform: 'WEB',
    deviceId: getDeviceId(),
    deviceName: 'Admin console',
    cookieRefresh: true,
    onSessionExpired: opts.onSessionExpired,
  });
}
