import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { type Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { loadConfig } from './config';

// ───────────── hashing & tokens ─────────────

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string | Buffer, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomDigits(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String(randomInt(0, 10));
  return s;
}

export function uuid(): string {
  return randomUUID();
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ───────────── AES-256-GCM secret encryption ─────────────

/** Encrypt a secret at rest. Output: v1:<iv>:<tag>:<ciphertext> (base64url). */
export function encryptSecret(plaintext: string, key: Buffer = loadConfig().encryptionKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

export function decryptSecret(payload: string, key: Buffer = loadConfig().encryptionKey): string {
  const [version, ivB, tagB, ctB] = payload.split(':');
  if (version !== 'v1' || !ivB || !tagB || ctB === undefined) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}

// ───────────── password / PIN hashing (Argon2id, OWASP parameters) ─────────────

// Algorithm.Argon2id === 2 (const enum, inlined to stay compatible with isolatedModules).
const ARGON_OPTS = { algorithm: 2 as Algorithm, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** A dummy hash so that login timing does not reveal whether an email exists. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('timing-equaliser-password');
  await verifyPassword(await dummyHash, password);
}

// ───────────── TOTP (RFC 6238) ─────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | ((mac[offset + 1]! & 0xff) << 16) | ((mac[offset + 2]! & 0xff) << 8) | (mac[offset + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function currentTotpStep(nowMs = Date.now(), period = 30): number {
  return Math.floor(nowMs / 1000 / period);
}

/**
 * Verify a TOTP code within ±window steps. Returns the matching step so callers can persist it and
 * reject replays (any step <= lastUsedStep is refused).
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { window?: number; lastUsedStep?: number | null; nowMs?: number } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentTotpStep(opts.nowMs);
  const window = opts.window ?? 1;
  for (let w = -window; w <= window; w++) {
    const step = now + w;
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    if (safeEqual(totpAt(secret, step), code)) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = 'GoCrypto'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Backup codes: returns plaintext (shown once) and their hashes (stored). */
export function generateBackupCodes(count = 10): { codes: string[]; hashes: string[] } {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let c = '';
    for (let j = 0; j < 8; j++) c += alphabet[randomInt(0, alphabet.length)];
    codes.push(`${c.slice(0, 4)}-${c.slice(4)}`);
  }
  return { codes, hashes: codes.map((c) => sha256Hex(c.replace('-', ''))) };
}

export function hashBackupCode(code: string): string {
  return sha256Hex(code.toUpperCase().replace('-', ''));
}

// ───────────── identifiers ─────────────

/** Public numeric UID (9 digits, no leading zero). */
export function generateUid(): string {
  return String(randomInt(100_000_000, 999_999_999));
}

/** Client order id compatible with the [A-Za-z0-9_-]{1,36} contract. */
export function newClientOrderId(prefix = 'gc'): string {
  return `${prefix}-${randomToken(12)}`.slice(0, 36);
}
