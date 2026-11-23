import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Deep links (scheme `gocrypto://`, see app.json), e.g. gocrypto://trade/ETHUSDT,
 * gocrypto://futures/BTCUSDT-PERP, gocrypto://deposit/USDT, gocrypto://notifications.
 * App screens only exist while signed in; links received while signed out are ignored.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['gocrypto://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Home: 'home',
          Markets: 'markets',
          Trade: 'trade/:symbol?',
          Futures: 'futures/:symbol?',
          Wallet: 'wallet',
          Profile: 'profile',
        },
      },
      Notifications: 'notifications',
      Deposit: 'deposit/:asset?',
      Withdraw: 'withdraw/:asset?',
      Transfer: 'transfer',
      WalletHistory: 'wallet/history',
      Devices: 'security/devices',
      Login: 'login',
      Register: 'register',
    },
  },
};
