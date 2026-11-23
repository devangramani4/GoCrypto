import pino, { type Logger } from 'pino';
import { loadConfig } from './config';

export type { Logger } from 'pino';

let root: Logger | null = null;

/** Fields that must never reach log sinks. */
const REDACT = [
  'password',
  'newPassword',
  'currentPassword',
  'pin',
  'currentPin',
  'newPin',
  'code',
  'totpCode',
  'emailCode',
  'backupCode',
  'refreshToken',
  'accessToken',
  'idToken',
  'identityToken',
  'secret',
  'mfaToken',
  'authorization',
  'cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.pin',
  '*.newPin',
  '*.currentPin',
  '*.code',
  '*.totpCode',
  '*.emailCode',
  '*.backupCode',
  '*.refreshToken',
  '*.accessToken',
  '*.idToken',
  '*.identityToken',
  '*.secret',
  '*.mfaToken',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-gc-signature"]',
];

export function getLogger(): Logger {
  if (root) return root;
  const cfg = loadConfig();
  root = pino({
    level: cfg.isTest ? (process.env.LOG_LEVEL ?? 'silent') : cfg.LOG_LEVEL,
    base: { service: cfg.SERVICE_NAME, env: cfg.APP_ENV },
    redact: { paths: REDACT, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(cfg.LOG_PRETTY
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } } }
      : {}),
  });
  return root;
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}
