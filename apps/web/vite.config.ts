/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Electron loads the renderer from file:// — use relative asset paths for the desktop build.
  base: mode === 'desktop' ? './' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:4001', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/lightweight-charts') || id.includes('node_modules/fancy-canvas')) return 'charts';
          if (/node_modules\/(react|react-dom|react-router|scheduler|@tanstack|zustand)\//.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
}));
