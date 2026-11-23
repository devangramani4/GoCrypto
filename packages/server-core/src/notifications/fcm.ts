import { SignJWT, importPKCS8 } from 'jose';

/** The fields of a Google service-account key file that FCM needs. */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

/**
 * Parses FCM_SERVICE_ACCOUNT: the service-account key file as JSON or base64-encoded JSON. Throws a
 * message that names the problem (never the key itself).
 */
export function parseServiceAccount(raw: string): FcmServiceAccount {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('FCM_SERVICE_ACCOUNT is required when PUSH_PROVIDER=fcm');
  const text = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT must be the service-account JSON (or base64-encoded JSON)');
  }
  const o = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const field = (k: string): string => {
    const v = o[k];
    if (typeof v !== 'string' || !v) throw new Error(`FCM_SERVICE_ACCOUNT is missing "${k}"`);
    return v;
  };
  return {
    project_id: field('project_id'),
    client_email: field('client_email'),
    private_key: field('private_key'),
    private_key_id: typeof o.private_key_id === 'string' ? o.private_key_id : undefined,
    token_uri: typeof o.token_uri === 'string' ? o.token_uri : undefined,
  };
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** sent · invalid-token (stop using it) · retryable (FCM unavailable / rate limited) · failed. */
export type FcmOutcome = 'sent' | 'invalid-token' | 'retryable' | 'failed';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** Must match the channel the Android app creates (MainApplication.kt / firebase.json). */
const ANDROID_CHANNEL_ID = 'default';

/** FCM data payload values must be strings. */
export function toFcmData(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

interface FcmErrorBody {
  error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
}

/**
 * Firebase Cloud Messaging HTTP v1 client. Authenticates with a service account (signed JWT exchanged
 * for an OAuth access token, cached until shortly before it expires). FCM delivers to Android directly
 * and to iOS through APNs.
 */
export class FcmClient {
  private token: { value: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly account: FcmServiceAccount,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  private accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return Promise.resolve(this.token.value);
    this.pending ??= this.requestAccessToken().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async requestAccessToken(): Promise<string> {
    const iat = Math.floor(this.now() / 1000);
    const tokenUri = this.account.token_uri ?? DEFAULT_TOKEN_URI;
    const key = await importPKCS8(this.account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        ...(this.account.private_key_id ? { kid: this.account.private_key_id } : {}),
      })
      .setIssuer(this.account.client_email)
      .setSubject(this.account.client_email)
      .setAudience(tokenUri)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await this.fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw new Error(`FCM OAuth token request failed with HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('FCM OAuth token response has no access_token');
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  /** Sends one notification to one registration token. Never throws. */
  async send(registrationToken: string, msg: PushMessage): Promise<FcmOutcome> {
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`;
    const payload = JSON.stringify({
      message: {
        token: registrationToken,
        notification: { title: msg.title, body: msg.body },
        data: toFcmData(msg.data),
        android: { priority: 'HIGH', notification: { channel_id: ANDROID_CHANNEL_ID, sound: 'default' } },
        apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
          body: payload,
        });
      } catch {
        return 'retryable'; // network error or OAuth outage
      }
      if (res.ok) return 'sent';
      if (res.status === 401 && attempt === 0) {
        this.token = null; // revoked/expired access token: fetch a new one once
        continue;
      }
      const err = (await res.json().catch(() => null)) as FcmErrorBody | null;
      const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode ?? err?.error?.status;
      // The app was uninstalled / the token rotated, or the token belongs to another Firebase project.
      if (res.status === 404 || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return 'invalid-token';
      if (res.status === 400 && /registration token/i.test(err?.error?.message ?? '')) return 'invalid-token';
      if (res.status === 429 || res.status >= 500) return 'retryable';
      return 'failed';
    }
    return 'failed';
  }
}
