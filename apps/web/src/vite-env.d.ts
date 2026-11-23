/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
}

/** Bridge exposed by the Electron preload script (contextIsolation). */
interface GoCryptoDesktopBridge {
  platform: 'win32' | 'darwin' | 'linux';
  version: string;
  secureStore: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string | null): Promise<void>;
  };
  notify(title: string, body: string): void;
  getConfig(): Promise<{ apiUrl: string; wsUrl: string }>;
  openExternal(url: string): void;
}

interface Window {
  gocryptoDesktop?: GoCryptoDesktopBridge;
}
