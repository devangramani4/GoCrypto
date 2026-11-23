/**
 * Seeds load-test users with funded wallets and ready-to-use sessions.
 *
 *   pnpm --filter @gocrypto/loadtest seed -- --users 20000 --out users.json
 *
 * Operator tool: it talks to the database directly (like the seed CLI) and mints sessions exactly the way
 * the auth service does (session row + token pair), so thousands of virtual users can start without
 * running thousands of Argon2 password checks first. Balances are credited through the wallet service, so
 * the ledger still reconciles. Refuses to run in production (APP_ENV=production) or outside TRADING_MODE=SANDBOX.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Core, hashPassword, sha256Hex } from '@gocrypto/server-core';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

export interface SeededUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

async function main(): Promise<void> {
  const total = Number(arg('users', '1000'));
  const out = arg('out', 'users.json');
  const password = arg('password', 'LoadTest-Passw0rd!');
  const prefix = arg('prefix', `lt${Date.now().toString(36)}`);
  const batchSize = Number(arg('batch', '200'));

  const core = await Core.create('loadtest-seed');
  const topup = arg('topup', '');
  // Seeded users get fabricated balances: only ever in a sandbox (paper-trading) deployment, never production.
  if (core.config.APP_ENV === 'production' || core.config.TRADING_MODE !== 'SANDBOX') {
    await core.close();
    throw new Error('Refusing to seed load-test users outside a sandbox, non-production deployment');
  }
  const usdt = core.assets.require('USDT');
  // Every spot base asset, worth ~$200k per user at current prices, so sell orders on any market work.
  const prices = await core.prices.usdPrices();
  const bases = [...new Set(core.markets.list('SPOT').map((m) => m.base))].filter((a) => a !== 'USDT');
  const baseCredits = bases.map((symbol) => {
    const px = Number(prices.get(symbol) ?? 0);
    const amount = px > 0 ? (200_000 / px).toFixed(Math.min(8, core.assets.require(symbol).decimals)) : '1000';
    return { assetId: core.assets.require(symbol).id, amount };
  });
  const credit = (userId: string) => [
    {
      userId,
      assetId: usdt.id,
      account: 'SPOT' as const,
      available: '1000000',
      type: 'ADJUSTMENT' as const,
      refType: 'LOADTEST',
    },
    {
      userId,
      assetId: usdt.id,
      account: 'FUTURES' as const,
      available: '500000',
      type: 'ADJUSTMENT' as const,
      refType: 'LOADTEST',
    },
    ...baseCredits.map((c) => ({
      userId,
      assetId: c.assetId,
      account: 'SPOT' as const,
      available: c.amount,
      type: 'ADJUSTMENT' as const,
      refType: 'LOADTEST',
    })),
  ];

  if (topup) {
    // Credit base assets to users of an existing users file (USDT already credited at seed time).
    const existing = (JSON.parse(readFileSync(topup, 'utf8')) as { users: SeededUser[] }).users;
    for (let start = 0; start < existing.length; start += batchSize) {
      const slice = existing.slice(start, start + batchSize);
      await core.db.transaction(async (tx) => {
        for (const u of slice)
          await core.wallet.apply(
            tx,
            credit(u.id).filter((c) => c.assetId !== usdt.id),
          );
      });
      process.stdout.write(`\rtopped up ${Math.min(existing.length, start + batchSize)}/${existing.length}`);
    }
    process.stdout.write('\n');
    await core.close();
    return;
  }
  const passwordHash = await hashPassword(password);
  const users: SeededUser[] = [];
  const started = Date.now();

  for (let start = 0; start < total; start += batchSize) {
    const n = Math.min(batchSize, total - start);
    const batch = await core.db.transaction(async (tx) => {
      const created: SeededUser[] = [];
      for (let i = 0; i < n; i++) {
        const idx = start + i;
        const email = `${prefix}+${idx}@loadtest.gocrypto`;
        const id = await core.users.createUser(tx, {
          email,
          passwordHash,
          emailVerified: true,
          displayName: `Load ${idx}`,
        });
        await core.wallet.apply(tx, credit(id));
        const device = await tx.execute(
          `INSERT INTO user_devices (user_id, device_id, name, platform, user_agent, last_ip) VALUES (?, ?, 'loadtest', 'WEB', 'gocrypto-loadtest', '127.0.0.1')`,
          [id, `loadtest-${idx}`],
        );
        const sessionId = randomUUID();
        const jti = randomBytes(24).toString('base64url');
        const expiresAt = Date.now() + core.config.JWT_REFRESH_TTL_SEC * 1000;
        await tx.execute(
          `INSERT INTO user_sessions (id, user_id, device_row_id, refresh_jti_hash, platform, ip, user_agent, expires_at)
           VALUES (?, ?, ?, ?, 'WEB', '127.0.0.1', 'gocrypto-loadtest', ?)`,
          [sessionId, id, device.insertId, sha256Hex(jti), new Date(expiresAt)],
        );
        const tokens = await core.auth.tokens.issuePair(id, sessionId, 'USER', jti, expiresAt);
        created.push({ id, email, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, sessionId });
      }
      return created;
    });
    users.push(...batch);
    process.stdout.write(`\rseeded ${users.length}/${total} users (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  writeFileSync(out, JSON.stringify({ password, users }));
  process.stdout.write(`\nwrote ${out} (password for login tests: ${password})\n`);
  await core.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
