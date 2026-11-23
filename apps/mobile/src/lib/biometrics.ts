import * as Keychain from 'react-native-keychain';
import { useLock } from '../store/lock';
import { randomUUID } from './random';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'passcode' | 'none';

export interface BiometricSupport {
  /** Something (biometrics or device passcode) can authenticate the user. */
  available: boolean;
  kind: BiometricKind;
  /** "Face ID", "Touch ID", "Fingerprint", "Device passcode"… */
  label: string;
}

const NONE: BiometricSupport = { available: false, kind: 'none', label: 'Biometric unlock' };

const BIOMETRY: Record<Keychain.BIOMETRY_TYPE, Omit<BiometricSupport, 'available'>> = {
  [Keychain.BIOMETRY_TYPE.FACE_ID]: { kind: 'face', label: 'Face ID' },
  [Keychain.BIOMETRY_TYPE.TOUCH_ID]: { kind: 'fingerprint', label: 'Touch ID' },
  [Keychain.BIOMETRY_TYPE.OPTIC_ID]: { kind: 'iris', label: 'Optic ID' },
  [Keychain.BIOMETRY_TYPE.FACE]: { kind: 'face', label: 'Face unlock' },
  [Keychain.BIOMETRY_TYPE.FINGERPRINT]: { kind: 'fingerprint', label: 'Fingerprint' },
  [Keychain.BIOMETRY_TYPE.IRIS]: { kind: 'iris', label: 'Iris' },
};

export async function getBiometricSupport(): Promise<BiometricSupport> {
  try {
    const [type, passcode] = await Promise.all([
      Keychain.getSupportedBiometryType(),
      Keychain.isPasscodeAuthAvailable(),
    ]);
    if (type && BIOMETRY[type]) return { available: true, ...BIOMETRY[type] };
    // No enrolled biometrics, but a device passcode/PIN/pattern can still be used.
    if (passcode) return { available: true, kind: 'passcode', label: 'Device passcode' };
    return NONE;
  } catch {
    return NONE;
  }
}

export type AuthOutcome = { success: true } | { success: false; cancelled: boolean; message: string };

/**
 * The app lock is a device-bound keychain item that can only be read after Face ID / Touch ID /
 * fingerprint or the device passcode succeeds — the OS, not JavaScript, decides whether the user
 * authenticated. Its value is a random, meaningless secret.
 */
const LOCK_SERVICE = 'gocrypto.applock';
const LOCK_ITEM: Keychain.SetOptions = {
  service: LOCK_SERVICE,
  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
  accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  storage: Keychain.STORAGE_TYPE.AES_GCM,
  cloudSync: false,
};

function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

function describe(code: string | undefined): string {
  switch (code) {
    case 'E_BIOMETRIC_LOCKOUT':
    case 'E_BIOMETRIC_LOCKOUT_PERMANENT':
      return 'Too many failed attempts. Use your device passcode or try again later.';
    case 'E_BIOMETRIC_NOT_ENROLLED':
    case 'E_PASSCODE_NOT_SET':
    case 'E_BIOMETRIC_UNAVAILABLE':
    case 'E_BIOMETRIC_TEMPORARILY_UNAVAILABLE':
      return 'Biometric unlock is not available on this device. Sign in again to continue.';
    case 'E_AUTH_INVALIDATED':
      return 'Your biometric settings changed. Try again, or sign in again to continue.';
    case 'E_BIOMETRIC_TIMEOUT':
      return 'Authentication timed out. Try again.';
    default:
      return 'Authentication failed. Try again.';
  }
}

/**
 * Face ID / Touch ID / fingerprint with device-passcode fallback. While the system prompt is up the
 * app turns "inactive" — the lock gate ignores that transition (no privacy cover flash).
 */
export async function authenticate(promptMessage: string): Promise<AuthOutcome> {
  useLock.getState().setAuthenticating(true);
  const authenticationPrompt: Keychain.AuthenticationPrompt = { title: promptMessage, cancel: 'Cancel' };
  try {
    let item = await Keychain.getGenericPassword({ service: LOCK_SERVICE, authenticationPrompt });
    if (!item) {
      // First use on this install (or after the item was invalidated): create it, then read it back —
      // the read is what requires the user to authenticate.
      await Keychain.setGenericPassword('applock', randomUUID(), { ...LOCK_ITEM, authenticationPrompt });
      item = await Keychain.getGenericPassword({ service: LOCK_SERVICE, authenticationPrompt });
    }
    if (item) return { success: true };
    return { success: false, cancelled: false, message: describe(undefined) };
  } catch (e) {
    const code = errorCode(e);
    // New fingerprints/faces invalidate the item's key: drop it so the next attempt re-creates it.
    if (code === 'E_AUTH_INVALIDATED')
      await Keychain.resetGenericPassword({ service: LOCK_SERVICE }).catch(() => undefined);
    return { success: false, cancelled: code === 'E_AUTH_CANCELED', message: describe(code) };
  } finally {
    useLock.getState().setAuthenticating(false);
  }
}
