import { keccak256, sha256, toHex, utf8 } from './hash';

export { sha256, keccak256, toHex } from './hash';

export type AddressFormat = 'BTC' | 'EVM' | 'TRON' | 'SOLANA' | 'XRP';

export interface AddressValidationResult {
  valid: boolean;
  reason?: string;
  /** Canonical form (e.g. EIP-55 checksum for EVM addresses). */
  normalized?: string;
}

const BTC_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const XRP_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

export function base58Decode(input: string, alphabet: string = BTC_ALPHABET): Uint8Array | null {
  if (input.length === 0) return null;
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = alphabet.indexOf(ch);
    if (value < 0) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of input) {
    if (ch === alphabet[0]) bytes.push(0);
    else break;
  }
  return new Uint8Array(bytes.reverse());
}

export function base58Encode(data: Uint8Array, alphabet: string = BTC_ALPHABET): string {
  const digits: number[] = [0];
  for (const byte of data) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of data) {
    if (byte === 0) out += alphabet[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += alphabet[digits[i]!];
  return out;
}

/** Decode base58check; returns the payload (without checksum) or null if the checksum fails. */
export function base58CheckDecode(input: string, alphabet: string = BTC_ALPHABET): Uint8Array | null {
  const raw = base58Decode(input, alphabet);
  if (!raw || raw.length < 5) return null;
  const payload = raw.slice(0, -4);
  const checksum = raw.slice(-4);
  const h = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) if (h[i] !== checksum[i]) return null;
  return payload;
}

export function base58CheckEncode(payload: Uint8Array, alphabet: string = BTC_ALPHABET): string {
  const h = sha256(sha256(payload));
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(h.slice(0, 4), payload.length);
  return base58Encode(full, alphabet);
}

// ---- bech32 / bech32m (BIP-173 / BIP-350) ----------------------------------------------------

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= G[i]!;
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

export function bech32Decode(addr: string): { hrp: string; data: number[]; variant: 'bech32' | 'bech32m' } | null {
  if (addr.length > 90) return null;
  const hasLower = addr !== addr.toUpperCase();
  const hasUpper = addr !== addr.toLowerCase();
  if (hasLower && hasUpper) return null;
  const s = addr.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) return null;
  const hrp = s.slice(0, pos);
  const data: number[] = [];
  for (const c of s.slice(pos + 1)) {
    const d = BECH32_CHARSET.indexOf(c);
    if (d < 0) return null;
    data.push(d);
  }
  const pm = bech32Polymod([...hrpExpand(hrp), ...data]);
  const variant = pm === BECH32_CONST ? 'bech32' : pm === BECH32M_CONST ? 'bech32m' : null;
  if (!variant) return null;
  return { hrp, data: data.slice(0, -6), variant };
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from !== 0) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

function validateSegwit(addr: string, hrp: string): boolean {
  const dec = bech32Decode(addr);
  if (!dec || dec.hrp !== hrp || dec.data.length < 1) return false;
  const version = dec.data[0]!;
  if (version > 16) return false;
  const program = convertBits(dec.data.slice(1), 5, 8, false);
  if (!program || program.length < 2 || program.length > 40) return false;
  if (version === 0 && program.length !== 20 && program.length !== 32) return false;
  if (version === 0 && dec.variant !== 'bech32') return false;
  if (version !== 0 && dec.variant !== 'bech32m') return false;
  return true;
}

// ---- per-format validators ------------------------------------------------------------------

export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = toHex(keccak256(utf8(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!;
    out += parseInt(hash[i]!, 16) >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

export function validateEvmAddress(address: string): AddressValidationResult {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { valid: false, reason: 'Invalid EVM address format' };
  const body = address.slice(2);
  const checksummed = toChecksumAddress(address);
  const isUniformCase = body === body.toLowerCase() || body === body.toUpperCase();
  if (!isUniformCase && checksummed !== address) return { valid: false, reason: 'Invalid EIP-55 checksum' };
  if (/^0x0{40}$/.test(address)) return { valid: false, reason: 'Zero address is not allowed' };
  return { valid: true, normalized: checksummed };
}

export function validateBitcoinAddress(address: string, testnet = false): AddressValidationResult {
  const lower = address.toLowerCase();
  const hrp = testnet ? 'tb' : 'bc';
  if (lower.startsWith(`${hrp}1`)) {
    return validateSegwit(address, hrp)
      ? { valid: true, normalized: lower }
      : { valid: false, reason: 'Invalid bech32 address' };
  }
  const payload = base58CheckDecode(address);
  if (!payload || payload.length !== 21) return { valid: false, reason: 'Invalid base58 address' };
  const version = payload[0];
  const allowed = testnet ? [0x6f, 0xc4] : [0x00, 0x05];
  if (version === undefined || !allowed.includes(version)) return { valid: false, reason: 'Wrong network version byte' };
  return { valid: true, normalized: address };
}

export function validateTronAddress(address: string): AddressValidationResult {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return { valid: false, reason: 'Invalid TRON address format' };
  const payload = base58CheckDecode(address);
  if (!payload || payload.length !== 21 || payload[0] !== 0x41) return { valid: false, reason: 'Invalid TRON checksum' };
  return { valid: true, normalized: address };
}

export function validateSolanaAddress(address: string): AddressValidationResult {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return { valid: false, reason: 'Invalid Solana address format' };
  const raw = base58Decode(address);
  if (!raw || raw.length !== 32) return { valid: false, reason: 'Solana address must decode to 32 bytes' };
  return { valid: true, normalized: address };
}

export function validateXrpAddress(address: string): AddressValidationResult {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return { valid: false, reason: 'Invalid XRP address format' };
  const payload = base58CheckDecode(address, XRP_ALPHABET);
  if (!payload || payload.length !== 21 || payload[0] !== 0x00) return { valid: false, reason: 'Invalid XRP checksum' };
  return { valid: true, normalized: address };
}

export function validateAddress(
  format: AddressFormat,
  address: string,
  opts: { testnet?: boolean } = {},
): AddressValidationResult {
  const a = address.trim();
  if (a.length === 0) return { valid: false, reason: 'Address is required' };
  switch (format) {
    case 'BTC':
      return validateBitcoinAddress(a, opts.testnet);
    case 'EVM':
      return validateEvmAddress(a);
    case 'TRON':
      return validateTronAddress(a);
    case 'SOLANA':
      return validateSolanaAddress(a);
    case 'XRP':
      return validateXrpAddress(a);
    default:
      return { valid: false, reason: 'Unsupported network' };
  }
}

/** Memo / destination tag rules per format. */
export function validateMemo(format: AddressFormat, memo: string | null | undefined): AddressValidationResult {
  if (memo == null || memo === '') return { valid: true };
  if (format === 'XRP') {
    return /^\d{1,10}$/.test(memo) && Number(memo) <= 4294967295
      ? { valid: true, normalized: memo }
      : { valid: false, reason: 'Destination tag must be an integer up to 4294967295' };
  }
  return memo.length <= 64 ? { valid: true, normalized: memo } : { valid: false, reason: 'Memo too long' };
}
