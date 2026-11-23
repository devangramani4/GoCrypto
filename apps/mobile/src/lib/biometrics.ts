import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { useLock } from '../store/lock';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'passcode' | 'none';

export interface BiometricSupport {
  /** Something (biometrics or device passcode) can authenticate the user. */
  available: boolean;
  kind: BiometricKind;
  /** "Face ID", "Touch ID", "Fingerprint", "Device passcode"… */
  label: string;
}

const NONE: BiometricSupport = { available: false, kind: 'none', label: 'Biometric unlock' };

export async function getBiometricSupport(): Promise<BiometricSupport> {
  try {
    const [hasHardware, enrolled, level, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const ios = Platform.OS === 'ios';
    if (hasHardware && enrolled) {
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        return { available: true, kind: 'face', label: ios ? 'Face ID' : 'Face unlock' };
      }
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return { available: true, kind: 'fingerprint', label: ios ? 'Touch ID' : 'Fingerprint' };
      }
      if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        return { available: true, kind: 'iris', label: 'Iris' };
      }
    }
    // No enrolled biometrics, but a device passcode/PIN/pattern can still be used.
    if (level !== LocalAuthentication.SecurityLevel.NONE)
      return { available: true, kind: 'passcode', label: 'Device passcode' };
    return NONE;
  } catch {
    return NONE;
  }
}

export type AuthOutcome = { success: true } | { success: false; cancelled: boolean; message: string };

function describe(error: LocalAuthentication.LocalAuthenticationError): string {
  switch (error) {
    case 'lockout':
      return 'Too many failed attempts. Use your device passcode or try again later.';
    case 'not_enrolled':
    case 'passcode_not_set':
    case 'not_available':
      return 'Biometric unlock is not available on this device. Sign in again to continue.';
    case 'timeout':
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
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    if (res.success) return { success: true };
    const cancelled =
      res.error === 'user_cancel' ||
      res.error === 'system_cancel' ||
      res.error === 'app_cancel' ||
      res.error === 'user_fallback';
    return { success: false, cancelled, message: describe(res.error) };
  } catch {
    return { success: false, cancelled: false, message: 'Authentication is unavailable right now.' };
  } finally {
    useLock.getState().setAuthenticating(false);
  }
}
