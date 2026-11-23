import { getApps } from '@react-native-firebase/app';
import {
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  setBackgroundMessageHandler,
  type Messaging,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { requestNotifications } from 'react-native-permissions';
import { api } from './api';
import { realtime } from './realtime';

/** FCM data payloads carry string values only (the server stringifies them). */
export type PushData = Record<string, string>;

/**
 * Firebase is only configured when the build ships google-services.json / GoogleService-Info.plist
 * (they are environment-specific and never committed). Without them push is simply unavailable.
 */
function messaging(): Messaging | null {
  try {
    return getApps().length > 0 ? getMessaging() : null;
  } catch {
    return null;
  }
}

function dataOf(message: RemoteMessage | null | undefined): PushData {
  const out: PushData = {};
  for (const [k, v] of Object.entries(message?.data ?? {})) if (typeof v === 'string') out[k] = v;
  return out;
}

export type PushRegistrationResult =
  { status: 'registered'; token: string } | { status: 'unsupported' | 'denied' | 'unconfigured' };

/**
 * Asks for notification permission (Android 13+ runtime permission, iOS authorization), obtains the
 * Firebase Cloud Messaging token and registers it for the signed-in user's current device
 * (`POST /auth/devices/push-token`, provider FCM). FCM delivers to iOS through APNs.
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  const m = messaging();
  if (!m) {
    if (__DEV__) console.warn('[push] Firebase is not configured for this build — skipping push registration.');
    return { status: 'unconfigured' };
  }
  const { status } = await requestNotifications(['alert', 'badge', 'sound']);
  if (status !== 'granted' && status !== 'limited') return { status: 'denied' };
  let token: string;
  try {
    // On iOS this waits for the APNs registration (enabled in firebase.json).
    token = await getToken(m);
  } catch (e) {
    if (__DEV__) console.warn('[push] no FCM token (simulator without APNs?)', e);
    return { status: 'unsupported' };
  }
  await api.auth.registerPushToken(token, 'FCM');
  return { status: 'registered', token };
}

/** Called when FCM rotates the device token, so it can be registered again. */
export function onPushTokenRefresh(listener: () => void): () => void {
  const m = messaging();
  return m ? onTokenRefresh(m, () => listener()) : () => undefined;
}

/**
 * Messages that arrive while the app is open. FCM does not show them as system banners. While the
 * socket is live the same event already arrives on `user:<id>:notifications` (shown as an in-app
 * toast), so the listener is only called when it is not.
 */
export function onForegroundPush(listener: (title: string, body: string, data: PushData) => void): () => void {
  const m = messaging();
  if (!m) return () => undefined;
  return onMessage(m, (message) => {
    if (realtime.connectionStatus === 'connected') return;
    const n = message.notification;
    if (n?.title || n?.body) listener(n.title ?? 'GoCrypto', n.body ?? '', dataOf(message));
  });
}

/** Taps on a system notification: while the app was in the background, or the tap that launched it. */
export function onPushOpened(listener: (data: PushData) => void): () => void {
  const m = messaging();
  if (!m) return () => undefined;
  void getInitialNotification(m)
    .then((message) => {
      if (message) listener(dataOf(message));
    })
    .catch(() => undefined);
  return onNotificationOpenedApp(m, (message) => listener(dataOf(message)));
}

/**
 * Required for messages that arrive while the app is in the background or not running (registered in
 * index.js before the app component). Notification messages are displayed by the OS; the app
 * refreshes its state from the API when it is opened, so there is nothing else to do here.
 */
export function registerBackgroundMessageHandler(): void {
  const m = messaging();
  if (m) setBackgroundMessageHandler(m, async () => undefined);
}
