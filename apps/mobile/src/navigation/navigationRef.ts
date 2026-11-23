import { NOTIFICATION_CATEGORY_OF, NOTIFICATION_TYPES, type NotificationType } from '@gocrypto/shared-types';
import { isOptionSymbol, isPerpSymbol } from '@gocrypto/trading-utils';
import { createNavigationContainerRef } from '@react-navigation/native';
import { useSession } from '../store/session';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let resolveReady: () => void = () => undefined;
/** Resolves once the NavigationContainer has mounted its navigators (cold-start deep links). */
export const navigationReady = new Promise<void>((resolve) => {
  resolveReady = resolve;
});
export function markNavigationReady(): void {
  resolveReady();
}

function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(v);
}

/**
 * Deep-links a notification (in-app toast tap or push response) to the most relevant screen.
 * `data` is the notification payload: `{ type, symbol?, orderId?, depositId?, … }`.
 */
export function openNotificationTarget(data: Record<string, unknown> | null | undefined): void {
  if (!navigationRef.isReady()) {
    void navigationReady.then(() => openNotificationTarget(data));
    return;
  }
  // App screens only exist while signed in.
  if (useSession.getState().status !== 'signedIn') return;

  const type = isNotificationType(data?.type) ? data.type : null;
  const symbol = typeof data?.symbol === 'string' ? data.symbol : null;
  const category = type ? NOTIFICATION_CATEGORY_OF[type] : null;

  if (category === 'TRADING' && symbol && !isOptionSymbol(symbol)) {
    if (isPerpSymbol(symbol)) navigationRef.navigate('Tabs', { screen: 'Futures', params: { symbol } });
    else navigationRef.navigate('Tabs', { screen: 'Trade', params: { symbol } });
    return;
  }
  if (category === 'WALLET') {
    const tab = type?.startsWith('WITHDRAWAL')
      ? 'withdrawals'
      : type === 'TRANSFER_RECEIVED'
        ? 'transfers'
        : 'deposits';
    navigationRef.navigate('WalletHistory', { tab });
    return;
  }
  if (category === 'SECURITY') {
    navigationRef.navigate('Devices');
    return;
  }
  navigationRef.navigate('Notifications');
}
