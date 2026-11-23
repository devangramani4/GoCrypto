import type { ErrorCode } from '@gocrypto/shared-types';

const DEFAULT_STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_REVOKED: 401,
  REFRESH_TOKEN_REUSED: 401,
  API_KEY_INVALID: 401,
  SIGNATURE_INVALID: 401,
  FORBIDDEN: 403,
  IP_NOT_ALLOWED: 403,
  ACCOUNT_FROZEN: 403,
  ACCOUNT_DISABLED: 403,
  TRADING_DISABLED: 403,
  WITHDRAWALS_DISABLED: 403,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  MARKET_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  NETWORK_NOT_FOUND: 404,
  RECIPIENT_NOT_FOUND: 404,
  NO_POSITION: 404,
  CONFLICT: 409,
  DUPLICATE_ORDER: 409,
  EMAIL_TAKEN: 409,
  PHONE_TAKEN: 409,
  IDEMPOTENCY_CONFLICT: 409,
  MFA_ALREADY_ENABLED: 409,
  POSITION_EXISTS: 409,
  OPEN_ORDERS_EXIST: 409,
  ACCOUNT_LOCKED: 423,
  PIN_LOCKED: 423,
  WITHDRAWAL_LOCKED: 423,
  RATE_LIMITED: 429,
  OTP_RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  ENGINE_TIMEOUT: 504,
};

/** Domain error carrying a stable error code and an HTTP status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message?: string, opts: { status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message ?? code, { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code] ?? 422;
    this.details = opts.details;
    this.expose = this.status < 500;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export const Errors = {
  notFound: (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`),
  forbidden: (msg = 'You do not have permission to perform this action') => new AppError('FORBIDDEN', msg),
  unauthorized: (msg = 'Authentication required') => new AppError('UNAUTHORIZED', msg),
  validation: (msg: string, details?: unknown) => new AppError('VALIDATION_ERROR', msg, { details }),
  insufficientBalance: (asset: string, required?: string, available?: string) =>
    new AppError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`, { details: { asset, required, available } }),
};

/** MySQL duplicate-key detection. */
export function isDuplicateKeyError(e: unknown, keyName?: string): boolean {
  const err = e as { code?: string; errno?: number; message?: string };
  if (err?.code !== 'ER_DUP_ENTRY' && err?.errno !== 1062) return false;
  return keyName ? Boolean(err.message?.includes(keyName)) : true;
}

/** MySQL CHECK constraint violation (e.g. a balance would go negative). */
export function isCheckConstraintError(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.errno === 4025 || err?.errno === 3819 || err?.code === 'ER_CONSTRAINT_FAILED';
}

export function isDeadlockError(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.errno === 1213 || err?.errno === 1205 || err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT';
}
