import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { config } from '../config';
import { api } from './api';
import { realtime } from './realtime';

export const ANDROID_CHANNEL_ID = 'default';

/**
 * Foreground presentation: while the socket is live the same event already arrives on
 * `user:<id>:notifications` and is shown as an in-app toast, so the OS banner is suppressed to
 * avoid duplicates. Without a live socket the system banner is shown instead.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const live = realtime.connectionStatus === 'connected';
    return {
      shouldShowBanner: !live,
      shouldShowList: true,
      shouldPlaySound: !live,
      shouldSetBadge: false,
    };
  },
});

export type PushRegistrationResult =
  { status: 'registered'; token: string } | { status: 'unsupported' | 'denied' | 'unconfigured' };

/**
 * Asks for notification permission, obtains the Expo push token and registers it for the signed-in
 * user's current device (`POST /auth/devices/push-token`, provider EXPO).
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  // Simulators/emulators cannot receive remote pushes.
  if (!Device.isDevice) return { status: 'unsupported' };

  if (Platform.OS === 'android') {
    // Android 13+ only shows the permission prompt once a channel exists.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Trading & account alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#6C7CFF',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    granted = asked.granted;
  }
  if (!granted) return { status: 'denied' };

  const projectId = config.easProjectId;
  if (!projectId) {
    if (__DEV__)
      console.warn('[push] No EAS projectId configured (expo.extra.eas.projectId) — skipping push registration.');
    return { status: 'unconfigured' };
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.auth.registerPushToken(token, 'EXPO');
  return { status: 'registered', token };
}
