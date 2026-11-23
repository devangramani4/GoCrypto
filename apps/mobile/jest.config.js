/** Unit tests for the app's JS logic. Native modules are replaced by the in-memory fakes in __mocks__/. */
module.exports = {
  preset: '@react-native/jest-preset',
  // Workspace packages (@gocrypto/*) ship TypeScript sources; React Native libraries ship untranspiled code.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-firebase|@react-native-clipboard|@react-navigation|react-native-.*|@gocrypto)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  clearMocks: true,
};
