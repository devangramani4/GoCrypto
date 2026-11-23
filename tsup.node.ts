import { type Options, defineConfig } from 'tsup';

/**
 * Shared bundle config for Node services and scripts.
 * Workspace packages (@gocrypto/*) ship TypeScript sources, so they are inlined into the bundle;
 * every third-party import stays external and is resolved from node_modules at runtime.
 */
export function nodeBundle(entry: Options['entry'], extra: Options = {}) {
  return defineConfig({
    entry,
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    splitting: false,
    noExternal: [/^@gocrypto\//],
    external: [/^(?![./]|@gocrypto\/)/],
    ...extra,
  });
}
