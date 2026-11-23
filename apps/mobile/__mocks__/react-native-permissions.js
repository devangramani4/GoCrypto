module.exports = {
  RESULTS: { UNAVAILABLE: 'unavailable', BLOCKED: 'blocked', DENIED: 'denied', GRANTED: 'granted', LIMITED: 'limited' },
  requestNotifications: jest.fn(async () => ({ status: 'granted', settings: {} })),
  checkNotifications: jest.fn(async () => ({ status: 'granted', settings: {} })),
};
