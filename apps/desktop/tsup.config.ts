import { defineConfig } from 'tsup';

// Main and preload are bundled to CommonJS (.cjs) for Electron; `electron` itself is provided at runtime.
export default defineConfig({
  entry: ['src/main.ts', 'src/preload.ts'],
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  external: ['electron'],
  outExtension: () => ({ js: '.cjs' }),
});
