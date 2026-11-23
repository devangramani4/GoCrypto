import { Platform, TurboModuleRegistry, type TurboModule } from 'react-native';
import appPackage from '../package.json';

/**
 * Runtime configuration. Values come from (highest priority first):
 *   1. GOCRYPTO_* environment variables inlined into the bundle at build time (babel.config.js), e.g.
 *      `GOCRYPTO_API_URL=https://api.example.com pnpm --filter @gocrypto/mobile android`
 *   2. local development defaults
 * Nothing in here is secret — the app never embeds credentials.
 */

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

interface SourceCodeSpec extends TurboModule {
  getConstants(): { scriptURL?: string | null };
}

/** Host of the Metro dev server the bundle was loaded from (development builds only). */
function devServerHost(): string | undefined {
  try {
    const scriptUrl = TurboModuleRegistry.get<SourceCodeSpec>('SourceCode')?.getConstants().scriptURL ?? '';
    return /^https?:\/\/([^/:]+)/.exec(scriptUrl)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * `localhost` points at the phone itself. In development rewrite it to the machine running Metro
 * (taken from the URL the bundle was loaded from), or to the Android emulator's host alias.
 */
export function resolveDevHost(
  url: string,
  env: { isDev: boolean; metroHost: string | undefined; os: string } = {
    isDev: __DEV__,
    metroHost: __DEV__ ? devServerHost() : undefined,
    os: Platform.OS,
  },
): string {
  if (!env.isDev) return url;
  const m = /^(\w+:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(.*)$/.exec(url);
  if (!m) return url;
  const [, scheme = '', , port = '', rest = ''] = m;
  const host = env.metroHost;
  if (host && host !== 'localhost' && host !== '127.0.0.1') return `${scheme}${host}${port}${rest}`;
  if (env.os === 'android') return `${scheme}10.0.2.2${port}${rest}`;
  return url;
}

function normalizeUrl(url: string): string {
  return resolveDevHost(url).replace(/\/+$/, '');
}

export const config = {
  apiUrl: normalizeUrl(str(process.env.GOCRYPTO_API_URL) ?? 'http://localhost:4000'),
  wsUrl: normalizeUrl(str(process.env.GOCRYPTO_WS_URL) ?? 'http://localhost:4001'),
  wsPath: str(process.env.GOCRYPTO_WS_PATH) ?? '/socket.io',
  /** Paper-trading / sandbox build (enables "Simulate deposit"). Only an explicit "false" turns it off. */
  sandbox: str(process.env.GOCRYPTO_SANDBOX) !== 'false',
  /** Same value Android uses for versionName (android/app/build.gradle reads package.json). */
  appVersion: appPackage.version,
} as const;

/** Seeded sandbox account e-mail offered as a shortcut in development builds only (no password is embedded). */
export const DEMO_EMAIL = __DEV__ ? 'demo@gocrypto.local' : null;

export const DEFAULT_SPOT_SYMBOL = 'BTCUSDT';
export const DEFAULT_FUTURES_SYMBOL = 'BTCUSDT-PERP';
