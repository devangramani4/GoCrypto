import { createHash, randomBytes } from 'node:crypto';
import {
  XRP_BASE58_ALPHABET,
  base58CheckEncode,
  base58Encode,
  encodeSegwitAddress,
  keccak256,
  toChecksumAddress,
  toHex,
} from '@gocrypto/trading-utils';
import type { NetworkInfo } from '../cache/markets';
import { loadConfig } from '../config';

/**
 * Custody integration point. Production deployments implement this against a regulated custodian
 * or MPC wallet; GoCrypto ships a sandbox implementation that derives checksum-valid addresses and
 * simulates broadcasts. Private keys never live in this codebase.
 */
export interface CustodyProvider {
  readonly name: string;
  depositAddress(network: NetworkInfo, userId: string): { address: string; memo: string | null };
  broadcastWithdrawal(input: { network: NetworkInfo; asset: string; address: string; memo: string | null; amount: string }): Promise<{ txHash: string }>;
}

function seed(...parts: string[]): Buffer {
  return createHash('sha256')
    .update([loadConfig().ENCRYPTION_KEY, ...parts].join('|'))
    .digest();
}

export class SandboxCustody implements CustodyProvider {
  readonly name = 'sandbox';

  depositAddress(network: NetworkInfo, userId: string): { address: string; memo: string | null } {
    switch (network.addressFormat) {
      case 'EVM': {
        // ERC20 / BEP20 share an EVM address per user, as on real exchanges.
        const hash = keccak256(seed('evm', userId));
        return { address: toChecksumAddress(`0x${toHex(hash.slice(12))}`), memo: null };
      }
      case 'BTC':
        return { address: encodeSegwitAddress('bc', 0, seed('btc', userId).subarray(0, 20)), memo: null };
      case 'TRON':
        return { address: base58CheckEncode(new Uint8Array([0x41, ...seed('tron', userId).subarray(0, 20)])), memo: null };
      case 'SOLANA':
        return { address: base58Encode(new Uint8Array(seed('sol', userId))), memo: null };
      case 'XRP': {
        // Shared exchange address + per-user destination tag.
        const address = base58CheckEncode(new Uint8Array([0x00, ...seed('xrp-hot').subarray(0, 20)]), XRP_BASE58_ALPHABET);
        const tag = String(100_000 + (Number(BigInt(userId) % 4_000_000_000n)));
        return { address, memo: tag };
      }
      default:
        throw new Error(`unsupported network ${network.code}`);
    }
  }

  async broadcastWithdrawal(input: { network: NetworkInfo }): Promise<{ txHash: string }> {
    const hex = randomBytes(32).toString('hex');
    return { txHash: input.network.addressFormat === 'EVM' ? `0x${hex}` : hex };
  }

  /** Random sandbox transaction hash for simulated deposits. */
  static fakeTxHash(network: NetworkInfo): string {
    const hex = randomBytes(32).toString('hex');
    return network.addressFormat === 'EVM' ? `0x${hex}` : hex;
  }
}
