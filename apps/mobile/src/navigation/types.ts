import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AccountType, MfaMethod } from '@gocrypto/shared-types';

export type AuthStackParamList = {
  Login: undefined;
  TwoFactor: { mfaToken: string; methods: MfaMethod[]; email: string };
  Register: undefined;
  ForgotPassword: { email?: string } | undefined;
};

export type TabParamList = {
  Home: undefined;
  Markets: undefined;
  Trade: { symbol?: string } | undefined;
  Futures: { symbol?: string } | undefined;
  Wallet: undefined;
  Profile: undefined;
};

export type WalletHistoryTab = 'deposits' | 'withdrawals' | 'transfers';

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Notifications: undefined;
  Deposit: { asset?: string } | undefined;
  Withdraw: { asset?: string } | undefined;
  Transfer: { asset?: string; from?: AccountType; to?: AccountType } | undefined;
  WalletHistory: { tab?: WalletHistoryTab } | undefined;
  SetPin: undefined;
  TwoFactorSetup: undefined;
  Devices: undefined;
  NotificationPrefs: undefined;
};

/** One root stack: auth screens or app screens are registered depending on the session. */
export type RootStackParamList = AuthStackParamList & AppStackParamList;

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  // Module augmentation documented by React Navigation for typed `useNavigation()`.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
