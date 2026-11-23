import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes ships without WebCrypto. `@gocrypto/api-client` derives idempotency keys and client order
 * ids from `crypto.randomUUID()` and only falls back to `Math.random()` when it is missing, so give
 * it a CSPRNG-backed implementation from expo-crypto before anything else is imported.
 */
interface CryptoShim {
  randomUUID?: () => string;
}

try {
  const g = globalThis as unknown as { crypto?: CryptoShim };
  if (!g.crypto) g.crypto = {};
  if (typeof g.crypto.randomUUID !== 'function') g.crypto.randomUUID = () => ExpoCrypto.randomUUID();
} catch {
  // A frozen/foreign `crypto` global: keep the library fallback.
}
