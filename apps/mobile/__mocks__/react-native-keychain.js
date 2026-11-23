/* In-memory react-native-keychain for unit tests: items keyed by service; scriptable failures. */
const ACCESSIBLE = {
  WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'AccessibleWhenPasscodeSetThisDeviceOnly',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly',
};
const ACCESS_CONTROL = {
  USER_PRESENCE: 'UserPresence',
  BIOMETRY_ANY: 'BiometryAny',
  BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
  DEVICE_PASSCODE: 'DevicePasscode',
  BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
  BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE: 'BiometryCurrentSetOrDevicePasscode',
};
const BIOMETRY_TYPE = {
  TOUCH_ID: 'TouchID',
  FACE_ID: 'FaceID',
  OPTIC_ID: 'OpticID',
  FINGERPRINT: 'Fingerprint',
  FACE: 'Face',
  IRIS: 'Iris',
};
const STORAGE_TYPE = { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth', AES_GCM: 'KeystoreAESGCM' };

const items = new Map();
const state = { biometryType: null, passcode: true, failures: [] };

function maybeFail() {
  const code = state.failures.shift();
  if (code) throw Object.assign(new Error(code), { code });
}

module.exports = {
  ACCESSIBLE,
  ACCESS_CONTROL,
  BIOMETRY_TYPE,
  STORAGE_TYPE,
  setGenericPassword: jest.fn(async (username, password, options = {}) => {
    maybeFail();
    const service = options.service ?? 'default';
    items.set(service, { username, password, options });
    return { service, storage: options.storage ?? 'keychain' };
  }),
  getGenericPassword: jest.fn(async (options = {}) => {
    maybeFail();
    const service = options.service ?? 'default';
    const item = items.get(service);
    return item ? { username: item.username, password: item.password, service, storage: 'keychain' } : false;
  }),
  resetGenericPassword: jest.fn(async (options = {}) => items.delete(options.service ?? 'default')),
  getSupportedBiometryType: jest.fn(async () => state.biometryType),
  isPasscodeAuthAvailable: jest.fn(async () => state.passcode),
  // Test helpers
  __items: items,
  __state: state,
  __failNext: (...codes) => state.failures.push(...codes),
  __reset: () => {
    items.clear();
    state.biometryType = null;
    state.passcode = true;
    state.failures = [];
  },
};
