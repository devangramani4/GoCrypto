import { getApps } from '@react-native-firebase/app';
import * as Messaging from '@react-native-firebase/messaging';
import { requestNotifications } from 'react-native-permissions';
import { api } from '../api';
import {
  onForegroundPush,
  onPushOpened,
  registerBackgroundMessageHandler,
  registerForPushNotifications,
} from '../push';
import { realtime } from '../realtime';

jest.mock('../api', () => ({ api: { auth: { registerPushToken: jest.fn(async () => undefined) } } }));
jest.mock('../realtime', () => ({ realtime: { connectionStatus: 'disconnected' } }));

const fcm = Messaging as typeof Messaging & { __emit: (kind: string, payload: unknown) => void };
const socket = realtime as { connectionStatus: string };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  socket.connectionStatus = 'disconnected';
});

describe('registerForPushNotifications', () => {
  it('asks for permission and registers the FCM token for this device', async () => {
    await expect(registerForPushNotifications()).resolves.toEqual({ status: 'registered', token: 'fcm-token-1' });
    expect(requestNotifications).toHaveBeenCalledWith(['alert', 'badge', 'sound']);
    expect(api.auth.registerPushToken).toHaveBeenCalledWith('fcm-token-1', 'FCM');
  });

  it('does nothing in a build without Firebase configuration', async () => {
    jest.mocked(getApps).mockReturnValueOnce([]);
    await expect(registerForPushNotifications()).resolves.toEqual({ status: 'unconfigured' });
    expect(requestNotifications).not.toHaveBeenCalled();
  });

  it('respects a denied permission', async () => {
    jest.mocked(requestNotifications).mockResolvedValueOnce({ status: 'blocked', settings: {} });
    await expect(registerForPushNotifications()).resolves.toEqual({ status: 'denied' });
    expect(api.auth.registerPushToken).not.toHaveBeenCalled();
  });

  it('reports devices that cannot obtain a token', async () => {
    jest.mocked(Messaging.getToken).mockRejectedValueOnce(new Error('no APNs token'));
    await expect(registerForPushNotifications()).resolves.toEqual({ status: 'unsupported' });
    expect(api.auth.registerPushToken).not.toHaveBeenCalled();
  });
});

describe('foreground pushes', () => {
  it('are surfaced only while the realtime socket is down (otherwise the socket already showed them)', () => {
    const titles: string[] = [];
    const off = onForegroundPush((title) => titles.push(title));
    const message = { notification: { title: 'Order filled', body: '0.1 BTC' }, data: { type: 'ORDER_FILLED' } };
    socket.connectionStatus = 'connected';
    fcm.__emit('message', message);
    socket.connectionStatus = 'disconnected';
    fcm.__emit('message', message);
    off();
    fcm.__emit('message', message);
    expect(titles).toEqual(['Order filled']);
  });
});

describe('opened pushes', () => {
  it('route the tap that launched the app and later taps, keeping string data only', async () => {
    jest.mocked(Messaging.getInitialNotification).mockResolvedValueOnce({
      data: { type: 'DEPOSIT_RECEIVED', depositId: '7', nested: { ignored: true } },
    } as never);
    const opened: unknown[] = [];
    const off = onPushOpened((data) => opened.push(data));
    await flush();
    fcm.__emit('opened', { data: { type: 'ORDER_FILLED', symbol: 'ETHUSDT' } });
    off();
    expect(opened).toEqual([
      { type: 'DEPOSIT_RECEIVED', depositId: '7' },
      { type: 'ORDER_FILLED', symbol: 'ETHUSDT' },
    ]);
  });
});

it('registers the background message handler when Firebase is configured', () => {
  registerBackgroundMessageHandler();
  expect(Messaging.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
  jest.mocked(getApps).mockReturnValueOnce([]);
  registerBackgroundMessageHandler();
  expect(Messaging.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
});
