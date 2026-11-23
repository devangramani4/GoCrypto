/** Runtime environment: browser (same-origin API behind the dev proxy / Nginx) or Electron desktop. */
export const isDesktop = typeof window !== 'undefined' && Boolean(window.gocryptoDesktop);

export interface Endpoints {
  apiUrl: string;
  wsUrl: string;
}

export async function resolveEndpoints(): Promise<Endpoints> {
  if (isDesktop) return window.gocryptoDesktop!.getConfig();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  return {
    apiUrl: import.meta.env.VITE_API_URL ?? '',
    wsUrl: import.meta.env.VITE_WS_URL ?? origin,
  };
}

/** Stable per-install device id (used for device management and new-device alerts). */
export function deviceId(): string {
  const key = 'gc.deviceId';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `web-ephemeral-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function deviceName(): string {
  if (isDesktop) return `GoCrypto Desktop (${window.gocryptoDesktop!.platform})`;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}
