import * as Keychain from 'react-native-keychain';
import { SECURE_KEYS, TOKEN_STORE_OPTIONS, secureDelete, secureGet, secureSet } from '../secureStorage';
import { keychain } from '../../testing/keychainFake';

beforeEach(() => keychain.__reset());

describe('secure storage', () => {
  it('keeps each key in its own device-only keychain item that never syncs to iCloud', async () => {
    await secureSet(SECURE_KEYS.tokens, '{"accessToken":"a"}', TOKEN_STORE_OPTIONS);
    expect(await secureGet(SECURE_KEYS.tokens)).toBe('{"accessToken":"a"}');
    expect(keychain.__items.get(SECURE_KEYS.tokens)?.options).toMatchObject({
      service: SECURE_KEYS.tokens,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      cloudSync: false,
    });

    await secureDelete(SECURE_KEYS.tokens);
    expect(await secureGet(SECURE_KEYS.tokens)).toBeNull();
  });

  it('treats an item that can no longer be decrypted as missing and removes it', async () => {
    await secureSet(SECURE_KEYS.settings, '{"theme":"dark"}');
    keychain.__failNext('E_STORAGE_ACCESS_ERROR');
    expect(await secureGet(SECURE_KEYS.settings)).toBeNull();
    expect(keychain.__items.has(SECURE_KEYS.settings)).toBe(false);
  });

  it('fails loudly when the keychain refuses a write', async () => {
    jest.mocked(Keychain.setGenericPassword).mockResolvedValueOnce(false);
    await expect(secureSet(SECURE_KEYS.deviceId, 'ios-1234')).rejects.toThrow(/refused/);
  });
});
