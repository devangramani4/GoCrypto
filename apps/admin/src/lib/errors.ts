import { ApiError } from '@gocrypto/api-client';
import type { ErrorCode } from '@gocrypto/shared-types';

export function isApiError(e: unknown, opts: { status?: number; code?: ErrorCode } = {}): e is ApiError {
  if (!(e instanceof ApiError)) return false;
  if (opts.status !== undefined && e.status !== opts.status) return false;
  if (opts.code !== undefined && e.code !== opts.code) return false;
  return true;
}

export const isForbidden = (e: unknown): boolean => isApiError(e, { status: 403 });
export const isUnauthorized = (e: unknown): boolean => isApiError(e, { status: 401 });

const FRIENDLY: Partial<Record<ErrorCode, string>> = {
  INVALID_CREDENTIALS: 'Invalid email or password.',
  INVALID_MFA_CODE: 'That code is not valid. Check your authenticator and try again.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  SERVICE_UNAVAILABLE: 'The server is unreachable. Check your connection and try again.',
};

/** Human readable message for any thrown value (API errors include server-side field details). */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) {
    const friendly = FRIENDLY[e.code];
    if (friendly) return friendly;
    if (e.code === 'VALIDATION_ERROR') {
      const fields = Object.entries(e.fieldErrors());
      if (fields.length) return fields.map(([k, v]) => (k === '_' ? v : `${k}: ${v}`)).join(' · ');
    }
    return e.message || fallback;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** Field errors from a server-side validation failure, keyed by field path. */
export function serverFieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError && e.code === 'VALIDATION_ERROR' ? e.fieldErrors() : {};
}
