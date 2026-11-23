// Metro configuration for the pnpm monorepo (node-linker=hoisted).
// Workspace packages (@gocrypto/*) ship TypeScript sources and are resolved through symlinks.
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  // 1. Watch the whole monorepo so edits in packages/* hot-reload.
  watchFolders: [workspaceRoot],
  resolver: {
    // 2. Resolve modules from the app first, then from the hoisted root node_modules.
    nodeModulesPaths: [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')],
    // 3. Workspace packages expose subpaths via "exports" (e.g. @gocrypto/ui/tokens).
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
