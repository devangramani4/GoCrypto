import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Load the nearest .env (repo root) once; never overrides variables already set; skipped in tests. */
function loadDotEnv(env: NodeJS.ProcessEnv): void {
  if (env !== process.env || env.NODE_ENV === 'test' || env.GOCRYPTO_SKIP_DOTENV === '1') return;
  const explicit = env.ENV_FILE;
  const candidates: string[] = [];
  if (explicit) candidates.push(path.resolve(explicit));
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    candidates.push(path.join(dir, '.env'));
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) break;
    dir = path.dirname(dir);
  }
  const file = candidates.find((f) => existsSync(f));
  if (file) {
    try {
      process.loadEnvFile(file);
    } catch {
      // malformed .env: fall back to the process environment
    }
  }
}

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0123456789';
const DEV_JWT_REFRESH_SECRET = 'dev-only-insecure-refresh-secret-change-me-012345';
// 32 zero-ish bytes in base64, dev only.
const DEV_ENCRYPTION_KEY = 'ZGV2LW9ubHktaW5zZWN1cmUtZW5jcnlwdGlvbi1rZXk=';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  /** SANDBOX = paper trading with simulated custody. LIVE requires explicit regulatory sign-off. */
  TRADING_MODE: z.enum(['SANDBOX', 'LIVE']).default('SANDBOX'),
  LIVE_TRADING_ACKNOWLEDGEMENT: z.string().default(''),
  SERVICE_NAME: z.string().default('gocrypto'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool.default(false),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(4000),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  WEB_APP_URL: z.string().default('http://localhost:5173'),
  ADMIN_APP_URL: z.string().default('http://localhost:5174'),
  /** Origin of the Electron renderer (custom app:// scheme), always added to CORS; set empty to disable desktop access. */
  DESKTOP_APP_ORIGIN: z.string().default('app://gocrypto'),
  CORS_ORIGINS: csv,
  TRUST_PROXY: bool.default(false),
  WS_PORT: z.coerce.number().int().default(4001),
  WS_PATH: z.string().default('/socket.io'),
  METRICS_PORT: z.coerce.number().int().default(0),
  METRICS_TOKEN: z.string().default(''),

  DATABASE_URL: z.string().default('mysql://gocrypto:gocrypto_dev_pw@127.0.0.1:3306/gocrypto'),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(500).default(20),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/0'),
  REDIS_KEY_PREFIX: z.string().default('gc:'),

  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  JWT_REFRESH_SECRET: z.string().min(32).default(DEV_JWT_REFRESH_SECRET),
  JWT_ISSUER: z.string().default('gocrypto'),
  JWT_AUDIENCE: z.string().default('gocrypto-clients'),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().min(3600).default(30 * 24 * 3600),
  /** Base64 encoded 32-byte key for AES-256-GCM encryption of TOTP secrets and API key secrets. */
  ENCRYPTION_KEY: z.string().default(DEV_ENCRYPTION_KEY),
  /** Internal service-to-service API keys (comma separated). */
  API_KEYS: csv,

  GOOGLE_CLIENT_IDS: csv,
  APPLE_CLIENT_IDS: csv,

  /** "log", an smtp:// URL, or a JSON object {"host","port","secure","user","pass","from"}. */
  EMAIL_CONFIG: z.string().default('log'),
  EMAIL_FROM: z.string().default('GoCrypto <no-reply@gocrypto.local>'),
  /** "log" or a JSON object for the SMS provider. */
  SMS_CONFIG: z.string().default('log'),
  /** "log" | "expo" (uses Expo push service) */
  PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
  EXPO_ACCESS_TOKEN: z.string().default(''),

  MARKET_DATA_MODE: z.enum(['SIMULATED', 'EXTERNAL']).default('SIMULATED'),
  MARKET_DATA_URL: z.string().default('wss://stream.binance.com:9443/stream'),
  MARKET_MAKER_ENABLED: bool.default(true),
  BACKFILL_HISTORY: bool.default(true),

  /** "redis" (separate engine process) or "inprocess" (engine hosted by the API, dev/tests). */
  ENGINE_MODE: z.enum(['redis', 'inprocess']).default('redis'),
  ENGINE_REPLY_TIMEOUT_MS: z.coerce.number().int().default(3000),
  FUNDING_INTERVAL_HOURS: z.coerce.number().int().min(1).max(24).default(8),

  RATE_LIMIT_MAX: z.coerce.number().int().default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
  ORDER_RATE_LIMIT_PER_SEC: z.coerce.number().int().default(20),

  SEED_ADMIN_EMAIL: z.string().default('admin@gocrypto.local'),
  SEED_ADMIN_PASSWORD: z.string().default(''),
  SEED_DEMO_USER: bool.default(true),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
  isSandbox: boolean;
  encryptionKey: Buffer;
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { reload?: boolean } = {}): AppConfig {
  if (cached && !opts.reload) return cached;
  loadDotEnv(env);
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const c = parsed.data;
  const encryptionKey = Buffer.from(c.ENCRYPTION_KEY, 'base64');
  if (encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key');

  const isProduction = c.NODE_ENV === 'production' || c.APP_ENV === 'production';
  if (isProduction) {
    const insecure: string[] = [];
    if (c.JWT_SECRET === DEV_JWT_SECRET) insecure.push('JWT_SECRET');
    if (c.JWT_REFRESH_SECRET === DEV_JWT_REFRESH_SECRET) insecure.push('JWT_REFRESH_SECRET');
    if (c.ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) insecure.push('ENCRYPTION_KEY');
    if (c.JWT_SECRET === c.JWT_REFRESH_SECRET) insecure.push('JWT_SECRET must differ from JWT_REFRESH_SECRET');
    if (insecure.length) throw new Error(`Refusing to start in production with insecure secrets: ${insecure.join(', ')}`);
  }
  if (c.TRADING_MODE === 'LIVE' && c.LIVE_TRADING_ACKNOWLEDGEMENT !== 'REGULATORY_REVIEW_COMPLETED') {
    throw new Error(
      'TRADING_MODE=LIVE requires LIVE_TRADING_ACKNOWLEDGEMENT=REGULATORY_REVIEW_COMPLETED. Custody, exchange, ' +
        'derivatives, KYC/AML and tax requirements must be reviewed for every jurisdiction before handling real funds.',
    );
  }

  cached = {
    ...c,
    CORS_ORIGINS: [...(c.CORS_ORIGINS.length ? c.CORS_ORIGINS : [c.WEB_APP_URL, c.ADMIN_APP_URL]), ...(c.DESKTOP_APP_ORIGIN ? [c.DESKTOP_APP_ORIGIN] : [])],
    isProduction,
    isTest: c.NODE_ENV === 'test',
    isSandbox: c.TRADING_MODE === 'SANDBOX',
    encryptionKey,
  };
  return cached;
}

/** Test helper: override config values. */
export function setConfigForTests(overrides: Partial<Record<keyof z.infer<typeof envSchema>, string>>): AppConfig {
  return loadConfig({ ...process.env, NODE_ENV: 'test', ...overrides }, { reload: true });
}
