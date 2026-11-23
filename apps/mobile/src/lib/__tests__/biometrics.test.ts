import * as Keychain from 'react-native-keychain';
import { useLock } from '../../store/lock';
import { authenticate, getBiometricSupport } from '../biometrics';
import { keychain } from '../../testing/keychainFake';

const LOCK = 'gocrypto.applock';

beforeEach(() => keychain.__reset());

describe('getBiometricSupport', () => {
  it.each([
    [Keychain.BIOMETRY_TYPE.FACE_ID, 'face', 'Face ID'],
    [Keychain.BIOMETRY_TYPE.TOUCH_ID, 'fingerprint', 'Touch ID'],
    [Keychain.BIOMETRY_TYPE.OPTIC_ID, 'iris', 'Optic ID'],
    [Keychain.BIOMETRY_TYPE.FINGERPRINT, 'fingerprint', 'Fingerprint'],
    [Keychain.BIOMETRY_TYPE.FACE, 'face', 'Face unlock'],
    [Keychain.BIOMETRY_TYPE.IRIS, 'iris', 'Iris'],
  ])('maps %s', async (type, kind, label) => {
    keychain.__state.biometryType = type;
    expect(await getBiometricSupport()).toEqual({ available: true, kind, label });
  });

  it('falls back to the device passcode when no biometrics are enrolled', async () => {
    expect(await getBiometricSupport()).toEqual({ available: true, kind: 'passcode', label: 'Device passcode' });
  });

  it('reports nothing when the device has neither', async () => {
    keychain.__state.passcode = false;
    expect(await getBiometricSupport()).toMatchObject({ available: false, kind: 'none' });
  });
});

describe('authenticate', () => {
  it('creates the protected lock item on first use, then authenticates by reading it', async () => {
    expect(await authenticate('Unlock GoCrypto')).toEqual({ success: true });
    expect(keychain.__items.get(LOCK)?.options).toMatchObject({
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
      accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      storage: Keychain.STORAGE_TYPE.AES_GCM,
      cloudSync: false,
    });
    expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(2);
    expect(Keychain.getGenericPassword).toHaveBeenLastCalledWith({
      service: LOCK,
      authenticationPrompt: { title: 'Unlock GoCrypto', cancel: 'Cancel' },
    });
  });

  it('afterwards only reads the item (the OS shows the biometric prompt)', async () => {
    await authenticate('Unlock GoCrypto');
    jest.clearAllMocks();
    expect(await authenticate('Unlock GoCrypto')).toEqual({ success: true });
    expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1);
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('treats a dismissed prompt as cancelled', async () => {
    keychain.__failNext('E_AUTH_CANCELED');
    expect(await authenticate('Unlock GoCrypto')).toMatchObject({ success: false, cancelled: true });
  });

  it('explains lockouts', async () => {
    keychain.__failNext('E_BIOMETRIC_LOCKOUT');
    const res = await authenticate('Unlock GoCrypto');
    expect(res).toMatchObject({ success: false, cancelled: false });
    expect(!res.success && res.message).toMatch(/Too many failed attempts/);
  });

  it('drops a lock item invalidated by newly enrolled biometrics', async () => {
    await authenticate('Unlock GoCrypto');
    keychain.__failNext('E_AUTH_INVALIDATED');
    expect(await authenticate('Unlock GoCrypto')).toMatchObject({ success: false, cancelled: false });
    expect(keychain.__items.has(LOCK)).toBe(false);
  });

  it('marks the system prompt as in progress for the lock gate', async () => {
    const seen: boolean[] = [];
    const unsubscribe = useLock.subscribe((s) => seen.push(s.authenticating));
    await authenticate('Unlock GoCrypto');
    unsubscribe();
    expect(seen).toEqual([true, false]);
  });
});
