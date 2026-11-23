import { exportPKCS8, generateKeyPair, jwtVerify, type CryptoKey } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { PushChannel } from './channels';
import { FcmClient, parseServiceAccount, toFcmData, type FcmServiceAccount } from './fcm';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://fcm.googleapis.com/v1/projects/gocrypto-test/messages:send';

async function serviceAccount(): Promise<{ account: FcmServiceAccount; publicKey: CryptoKey }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return {
    account: {
      project_id: 'gocrypto-test',
      client_email: 'push@gocrypto-test.iam.gserviceaccount.com',
      private_key: await exportPKCS8(privateKey),
      private_key_id: 'key-1',
    },
    publicKey,
  };
}

interface Reply {
  status: number;
  body?: unknown;
}

/** Fake Google endpoints: the OAuth token exchange and the FCM v1 send API. */
function fakeGoogle(reply: (token: string) => Reply = () => ({ status: 200 })) {
  const tokenRequests: URLSearchParams[] = [];
  const sends: { auth: string; body: { message: Record<string, unknown> & { token: string } } }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === TOKEN_URI) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({ access_token: `ya29.access-${tokenRequests.length}`, expires_in: 3600 }), {
        status: 200,
      });
    }
    expect(String(url)).toBe(SEND_URL);
    const body = JSON.parse(String(init?.body)) as (typeof sends)[number]['body'];
    sends.push({ auth: new Headers(init?.headers).get('authorization') ?? '', body });
    const r = reply(body.message.token);
    return new Response(JSON.stringify(r.body ?? { name: 'projects/gocrypto-test/messages/1' }), { status: r.status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, tokenRequests, sends };
}

const fcmError = (status: string, errorCode?: string, message = 'error') => ({
  error: {
    status,
    message,
    details: errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : [],
  },
});

describe('parseServiceAccount', () => {
  const json = JSON.stringify({
    project_id: 'p',
    client_email: 'e@p.iam.gserviceaccount.com',
    private_key: 'k',
    type: 'service_account',
  });

  it('accepts the key file as JSON or base64', () => {
    expect(parseServiceAccount(json)).toMatchObject({ project_id: 'p', client_email: 'e@p.iam.gserviceaccount.com' });
    expect(parseServiceAccount(Buffer.from(json).toString('base64')).project_id).toBe('p');
  });

  it('names what is missing without echoing the secret', () => {
    expect(() => parseServiceAccount('')).toThrow(/required when PUSH_PROVIDER=fcm/);
    expect(() => parseServiceAccount('not json')).toThrow(/service-account JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ project_id: 'p', client_email: 'e' }))).toThrow(
      /missing "private_key"/,
    );
  });
});

describe('toFcmData', () => {
  it('stringifies values (FCM data must be strings) and drops empty ones', () => {
    expect(toFcmData({ type: 'ORDER_FILLED', orderId: 42, nested: { a: 1 }, flag: true, none: null })).toEqual({
      type: 'ORDER_FILLED',
      orderId: '42',
      nested: '{"a":1}',
      flag: 'true',
    });
  });
});

describe('FcmClient', () => {
  it('exchanges a signed service-account JWT for an access token and sends an FCM v1 message', async () => {
    const { account, publicKey } = await serviceAccount();
    const google = fakeGoogle();
    const client = new FcmClient(account, google.fetchImpl);

    await expect(
      client.send('device-token-1', {
        title: 'Order filled',
        body: '0.1 BTC',
        data: { type: 'ORDER_FILLED', orderId: 7 },
      }),
    ).resolves.toBe('sent');

    expect(google.tokenRequests).toHaveLength(1);
    expect(google.tokenRequests[0]!.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload, protectedHeader } = await jwtVerify(google.tokenRequests[0]!.get('assertion')!, publicKey, {
      issuer: account.client_email,
      subject: account.client_email,
      audience: TOKEN_URI,
    });
    expect(payload.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(protectedHeader).toMatchObject({ alg: 'RS256', kid: 'key-1' });

    expect(google.sends).toHaveLength(1);
    expect(google.sends[0]!.auth).toBe('Bearer ya29.access-1');
    expect(google.sends[0]!.body.message).toEqual({
      token: 'device-token-1',
      notification: { title: 'Order filled', body: '0.1 BTC' },
      data: { type: 'ORDER_FILLED', orderId: '7' },
      android: { priority: 'HIGH', notification: { channel_id: 'default', sound: 'default' } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    });
  });

  it('reuses the access token until shortly before it expires', async () => {
    const { account } = await serviceAccount();
    const google = fakeGoogle();
    let now = 1_700_000_000_000;
    const client = new FcmClient(account, google.fetchImpl, () => now);
    await Promise.all([client.send('a', { title: 't', body: 'b' }), client.send('b', { title: 't', body: 'b' })]);
    await client.send('c', { title: 't', body: 'b' });
    expect(google.tokenRequests).toHaveLength(1);
    now += 3600_000 - 30_000; // inside the one-minute refresh margin
    await client.send('d', { title: 't', body: 'b' });
    expect(google.tokenRequests).toHaveLength(2);
  });

  it('refreshes a rejected access token once', async () => {
    const { account } = await serviceAccount();
    let first = true;
    const google = fakeGoogle(() => {
      if (first) {
        first = false;
        return { status: 401, body: fcmError('UNAUTHENTICATED') };
      }
      return { status: 200 };
    });
    const client = new FcmClient(account, google.fetchImpl);
    await expect(client.send('device', { title: 't', body: 'b' })).resolves.toBe('sent');
    expect(google.tokenRequests).toHaveLength(2);
    expect(google.sends.map((s) => s.auth)).toEqual(['Bearer ya29.access-1', 'Bearer ya29.access-2']);
  });

  it.each<[string, Reply, string]>([
    ['an uninstalled app', { status: 404, body: fcmError('NOT_FOUND', 'UNREGISTERED') }, 'invalid-token'],
    [
      'a token from another Firebase project',
      { status: 403, body: fcmError('PERMISSION_DENIED', 'SENDER_ID_MISMATCH') },
      'invalid-token',
    ],
    [
      'a malformed token',
      {
        status: 400,
        body: fcmError(
          'INVALID_ARGUMENT',
          'INVALID_ARGUMENT',
          'The registration token is not a valid FCM registration token',
        ),
      },
      'invalid-token',
    ],
    ['an FCM outage', { status: 503, body: fcmError('UNAVAILABLE', 'UNAVAILABLE') }, 'retryable'],
    ['rate limiting', { status: 429, body: fcmError('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED') }, 'retryable'],
    [
      'any other rejected request',
      { status: 400, body: fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Invalid JSON payload') },
      'failed',
    ],
  ])('classifies %s', async (_case, reply, outcome) => {
    const { account } = await serviceAccount();
    const client = new FcmClient(account, fakeGoogle(() => reply).fetchImpl);
    await expect(client.send('device', { title: 't', body: 'b' })).resolves.toBe(outcome);
  });
});

describe('PushChannel', () => {
  it('only logs when PUSH_PROVIDER=log', async () => {
    const google = fakeGoogle();
    const channel = new PushChannel({ PUSH_PROVIDER: 'log', FCM_SERVICE_ACCOUNT: '' }, google.fetchImpl);
    await expect(channel.send([{ token: 't', provider: 'FCM' }], 'title', 'body')).resolves.toEqual({
      sent: 0,
      invalidTokens: [],
      retryable: 0,
    });
    expect(google.fetchImpl).not.toHaveBeenCalled();
  });

  it('delivers to FCM tokens and reports the ones to drop', async () => {
    const { account } = await serviceAccount();
    const google = fakeGoogle((token) =>
      token === 'gone'
        ? { status: 404, body: fcmError('NOT_FOUND', 'UNREGISTERED') }
        : token === 'busy'
          ? { status: 503 }
          : { status: 200 },
    );
    const channel = new PushChannel(
      { PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT: JSON.stringify(account) },
      google.fetchImpl,
    );
    const result = await channel.send(
      [
        { token: 'ok-1', provider: 'FCM' },
        { token: 'gone', provider: 'FCM' },
        { token: 'busy', provider: 'FCM' },
        { token: 'web-endpoint', provider: 'WEB' },
      ],
      'Deposit received',
      '100 USDT',
      { type: 'DEPOSIT_RECEIVED' },
    );
    expect(result).toEqual({ sent: 1, invalidTokens: ['gone'], retryable: 1 });
    expect(google.sends.map((s) => s.body.message.token).sort()).toEqual(['busy', 'gone', 'ok-1']);
  });
});
