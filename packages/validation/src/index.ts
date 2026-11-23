export * from './common';
export * from './auth';
export * from './trading';
export * from './wallet';
export * from './admin';
export { z } from 'zod';

import type { z as zod } from 'zod';

/** Flatten a ZodError into `{ field: message }` for form display. */
export function fieldErrors(error: zod.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
