// Build-time configuration is read from GOCRYPTO_* environment variables and inlined into the bundle
// (see src/config.ts). Only these names are inlined — never put secrets in them.
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // `export * as ns from` (used by zod v4) is not covered by the React Native preset.
    '@babel/plugin-transform-export-namespace-from',
    [
      'transform-inline-environment-variables',
      { include: ['GOCRYPTO_API_URL', 'GOCRYPTO_WS_URL', 'GOCRYPTO_WS_PATH', 'GOCRYPTO_SANDBOX'] },
    ],
  ],
};
