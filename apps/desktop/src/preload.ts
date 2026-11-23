/**
 * Sandboxed preload: exposes a minimal, typed bridge to the renderer (see apps/web/src/vite-env.d.ts).
 * No Node.js APIs leak into the page — only these functions, each backed by a validated IPC channel.
 */
import { contextBridge, ipcRenderer } from 'electron';

const versionArg = process.argv.find((a) => a.startsWith('--gocrypto-version='));

const bridge = {
  platform: process.platform as 'win32' | 'darwin' | 'linux',
  version: versionArg ? (versionArg.split('=')[1] ?? '') : '',
  secureStore: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('secure-store:get', key),
    set: (key: string, value: string | null): Promise<void> => ipcRenderer.invoke('secure-store:set', key, value),
  },
  notify: (title: string, body: string): void => ipcRenderer.send('notify', String(title), String(body)),
  getConfig: (): Promise<{ apiUrl: string; wsUrl: string }> => ipcRenderer.invoke('config:get'),
  openExternal: (url: string): void => ipcRenderer.send('open-external', String(url)),
};

contextBridge.exposeInMainWorld('gocryptoDesktop', Object.freeze(bridge));
