import * as SecureStore from 'expo-secure-store';
import type { StateStorage } from 'zustand/middleware';

/**
 * Everything the app persists lives in the iOS Keychain / Android Keystore via expo-secure-store.
 * Keys may only contain [A-Za-z0-9._-].
 */
export const SECURE_KEYS = {
  tokens: 'gocrypto.auth.tokens',
  deviceId: 'gocrypto.device.id',
  settings: 'gocrypto.settings',
} as const;

/**
 * Session tokens: never migrated to another device or backup. "After first unlock" (rather than
 * "when unlocked") so a token rotation that happens while the phone locks in the background can
 * still be persisted — losing a rotated refresh token would trip the server's reuse detection.
 */
export const TOKEN_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Device id and preferences: available after first unlock, never migrated to another device. */
export const DEVICE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Reads never throw: a Keystore entry that can no longer be decrypted (e.g. after the user changed
 * the device lock or restored a backup) is treated as missing and removed.
 */
export async function secureGet(key: string, options?: SecureStore.SecureStoreOptions): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, options);
  } catch {
    await secureDelete(key, options);
    return null;
  }
}

export async function secureSet(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void> {
  await SecureStore.setItemAsync(key, value, options);
}

export async function secureDelete(key: string, options?: SecureStore.SecureStoreOptions): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, options);
  } catch {
    // nothing stored / not accessible — nothing to delete
  }
}

/** Synchronous read used once at startup (device id). */
export function secureGetSync(key: string, options?: SecureStore.SecureStoreOptions): string | null {
  try {
    return SecureStore.getItem(key, options);
  } catch {
    return null;
  }
}

export function secureSetSync(key: string, value: string, options?: SecureStore.SecureStoreOptions): void {
  try {
    SecureStore.setItem(key, value, options);
  } catch {
    // Persisting failed: the id is still valid for this run.
  }
}

/** zustand `persist` adapter for non-sensitive preferences. */
export const secureStateStorage: StateStorage = {
  getItem: (name) => secureGet(name, DEVICE_STORE_OPTIONS),
  setItem: (name, value) => secureSet(name, value, DEVICE_STORE_OPTIONS).catch(() => undefined),
  removeItem: (name) => secureDelete(name, DEVICE_STORE_OPTIONS),
};
