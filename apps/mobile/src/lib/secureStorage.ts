import * as Keychain from 'react-native-keychain';
import type { StateStorage } from 'zustand/middleware';

/**
 * Everything the app persists lives in the iOS Keychain / Android Keystore (react-native-keychain).
 * Each key is its own keychain item ("service"); values are never synced to iCloud.
 */
export const SECURE_KEYS = {
  tokens: 'gocrypto.auth.tokens',
  deviceId: 'gocrypto.device.id',
  settings: 'gocrypto.settings',
} as const;

export interface SecureStoreOptions {
  accessible: Keychain.ACCESSIBLE;
}

/**
 * Session tokens: never migrated to another device or backup. "After first unlock" (rather than
 * "when unlocked") so a token rotation that happens while the phone locks in the background can
 * still be persisted — losing a rotated refresh token would trip the server's reuse detection.
 */
export const TOKEN_STORE_OPTIONS: SecureStoreOptions = {
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Device id and preferences: available after first unlock, never migrated to another device. */
export const DEVICE_STORE_OPTIONS: SecureStoreOptions = {
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The keychain "username" of every item (the key is the service). */
const ACCOUNT = 'gocrypto';

function itemOptions(key: string, options?: SecureStoreOptions): Keychain.SetOptions {
  return {
    service: key,
    accessible: options?.accessible ?? Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    // Android: AES-GCM key held by the Android Keystore. No per-read user authentication — the
    // biometric app lock (lib/biometrics.ts) gates the UI instead.
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    cloudSync: false,
  };
}

/**
 * Reads never throw: an entry that can no longer be decrypted (e.g. after the user changed the
 * device lock or restored a backup) is treated as missing and removed.
 */
export async function secureGet(key: string, options?: SecureStoreOptions): Promise<string | null> {
  try {
    const item = await Keychain.getGenericPassword({ service: key });
    return item ? item.password : null;
  } catch {
    await secureDelete(key, options);
    return null;
  }
}

export async function secureSet(key: string, value: string, options?: SecureStoreOptions): Promise<void> {
  const stored = await Keychain.setGenericPassword(ACCOUNT, value, itemOptions(key, options));
  if (!stored) throw new Error(`Secure storage refused to store "${key}"`);
}

export async function secureDelete(key: string, _options?: SecureStoreOptions): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: key });
  } catch {
    // nothing stored / not accessible — nothing to delete
  }
}

/** zustand `persist` adapter for non-sensitive preferences. */
export const secureStateStorage: StateStorage = {
  getItem: (name) => secureGet(name, DEVICE_STORE_OPTIONS),
  setItem: (name, value) => secureSet(name, value, DEVICE_STORE_OPTIONS).catch(() => undefined),
  removeItem: (name) => secureDelete(name, DEVICE_STORE_OPTIONS),
};
