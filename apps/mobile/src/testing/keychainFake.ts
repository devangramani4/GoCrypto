import * as Keychain from 'react-native-keychain';

/** Typed handle on the in-memory keychain in __mocks__/react-native-keychain.js. */
export type KeychainFake = typeof Keychain & {
  __items: Map<string, { username: string; password: string; options: Keychain.SetOptions }>;
  __state: { biometryType: Keychain.BIOMETRY_TYPE | null; passcode: boolean };
  __failNext: (...codes: string[]) => void;
  __reset: () => void;
};

export const keychain = Keychain as unknown as KeychainFake;
