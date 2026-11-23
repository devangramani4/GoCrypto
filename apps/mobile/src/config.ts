import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Runtime configuration. Values come from (highest priority first):
 *   1. EXPO_PUBLIC_* environment variables inlined at build time (see eas.json profiles)
 *   2. `expo.extra` in app.json
 *   3. local development defaults
 * Nothing in here is secret — the app never embeds credentials.
 */

const extra: Record<string, unknown> = Constants.expoConfig?.extra ?? {};

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readProjectId(): string | undefined {
  const eas = extra.eas;
  if (typeof eas === 'object' && eas !== null && 'projectId' in eas) {
    const id = str((eas as { projectId: unknown }).projectId);
    if (id) return id;
  }
  return str(Constants.easConfig?.projectId);
}

/**
 * `localhost` points at the phone itself. In development rewrite it to the machine running Metro
 * (taken from the dev-server host), or to the Android emulator's host alias.
 */
function resolveDevHost(url: string): string {
  if (!__DEV__) return url;
  const m = /^(\w+:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(.*)$/.exec(url);
  if (!m) return url;
  const [, scheme = '', , port = '', rest = ''] = m;
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') return `${scheme}${devHost}${port}${rest}`;
  if (Platform.OS === 'android') return `${scheme}10.0.2.2${port}${rest}`;
  return url;
}

function normalizeUrl(url: string): string {
  return resolveDevHost(url).replace(/\/+$/, '');
}

export const config = {
  apiUrl: normalizeUrl(str(process.env.EXPO_PUBLIC_API_URL) ?? str(extra.apiUrl) ?? 'http://localhost:4000'),
  wsUrl: normalizeUrl(str(process.env.EXPO_PUBLIC_WS_URL) ?? str(extra.wsUrl) ?? 'http://localhost:4001'),
  wsPath: str(extra.wsPath) ?? '/socket.io',
  /** Paper-trading / sandbox build (enables "Simulate deposit"). */
  sandbox: extra.sandbox !== false,
  easProjectId: readProjectId(),
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;

/** Seeded sandbox account e-mail offered as a shortcut in development builds only (no password is embedded). */
export const DEMO_EMAIL = __DEV__ ? 'demo@gocrypto.local' : null;

export const DEFAULT_SPOT_SYMBOL = 'BTCUSDT';
export const DEFAULT_FUTURES_SYMBOL = 'BTCUSDT-PERP';
