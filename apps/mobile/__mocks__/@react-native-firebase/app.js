/* Firebase "configured" by default; tests return [] from getApps() to simulate a build without it. */
module.exports = { getApps: jest.fn(() => [{ name: '[DEFAULT]' }]) };
