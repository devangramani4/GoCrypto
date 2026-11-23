/* Firebase Cloud Messaging fake: listeners can be triggered from tests with __emit(kind, payload). */
const listeners = { message: new Set(), opened: new Set(), token: new Set() };
const subscribe = (kind) => (_messaging, listener) => {
  listeners[kind].add(listener);
  return () => listeners[kind].delete(listener);
};
module.exports = {
  getMessaging: jest.fn(() => ({ app: '[DEFAULT]' })),
  getToken: jest.fn(async () => 'fcm-token-1'),
  onMessage: jest.fn(subscribe('message')),
  onNotificationOpenedApp: jest.fn(subscribe('opened')),
  onTokenRefresh: jest.fn(subscribe('token')),
  getInitialNotification: jest.fn(async () => null),
  setBackgroundMessageHandler: jest.fn(),
  __emit: (kind, payload) => {
    for (const listener of [...listeners[kind]]) listener(payload);
  },
  __listenerCount: (kind) => listeners[kind].size,
};
