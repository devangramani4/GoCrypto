import { ApiError } from '@gocrypto/api-client';
import type { ErrorCode } from '@gocrypto/shared-types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** `instanceof` can fail across transpiled Error subclasses, so also duck-type the shape. */
export function isApiError(e: unknown): e is ApiError {
  if (e instanceof ApiError) return true;
  return isRecord(e) && e.name === 'ApiError' && typeof e.code === 'string' && typeof e.status === 'number';
}

export function errorCode(e: unknown): ErrorCode | null {
  return isApiError(e) ? e.code : null;
}

export function isNetworkError(e: unknown): boolean {
  return isApiError(e) && e.status === 0;
}

const FRIENDLY: Partial<Record<ErrorCode, string>> = {
  SERVICE_UNAVAILABLE: 'GoCrypto is unreachable. Check your connection and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
  ENGINE_TIMEOUT: 'The matching engine is busy. Check your open orders before retrying.',
};

/** User-facing message for any thrown value (server messages are already human readable). */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isApiError(e)) {
    if (e.status === 0) return FRIENDLY.SERVICE_UNAVAILABLE ?? fallback;
    return FRIENDLY[e.code] ?? (e.message || fallback);
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** Field-level messages from server-side validation (`{ field: message }`). */
export function apiFieldErrors(e: unknown): Record<string, string> {
  if (isApiError(e) && typeof e.fieldErrors === 'function') return e.fieldErrors();
  return {};
}
