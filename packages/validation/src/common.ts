import { z } from 'zod';
import { ACCOUNT_TYPES, MARKET_TYPES, PLATFORMS } from '@gocrypto/shared-types';

/** Non-negative decimal string without exponent, e.g. "0.015". */
export const decimalString = z
  .string()
  .trim()
  .max(48, 'Number too long')
  .regex(/^\d+(\.\d+)?$/, 'Must be a decimal number');

/** Strictly positive decimal string. */
export const positiveDecimal = decimalString.refine((v) => /[1-9]/.test(v), 'Must be greater than zero');

export const symbolSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Z0-9][A-Z0-9\-]*$/, 'Invalid symbol');

export const assetSymbol = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Z0-9]+$/, 'Invalid asset');

export const networkCode = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Z0-9_]+$/, 'Invalid network');

export const idString = z.string().trim().regex(/^\d{1,20}$/, 'Invalid id');
export const uuidString = z.uuid();

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Invalid email address'));

export const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format, e.g. +14155552671');

export const totpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const otpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const backupCode = z.string().trim().regex(/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/, 'Invalid backup code');
export const pinCode = z
  .string()
  .regex(/^\d{6}$/, 'PIN must be 6 digits')
  .refine((v) => !/^(\d)\1{5}$/.test(v) && !['123456', '654321', '012345', '543210'].includes(v), 'PIN is too simple');

/** Password policy: 10-128 chars with lower, upper and digit. */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[a-z]/.test(v), 'Password needs a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password needs an uppercase letter')
  .refine((v) => /\d/.test(v), 'Password needs a number');

export const deviceId = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_\-:.]+$/, 'Invalid device id');

export const platformSchema = z.enum(PLATFORMS);
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const marketTypeSchema = z.enum(MARKET_TYPES);

export const clientOrderId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_\-]{1,36}$/, 'clientOrderId must be 1-36 chars of [A-Za-z0-9_-]');

export const idempotencyKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_\-]{8,64}$/, 'Invalid idempotency key');

export const cursorQuery = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const timeRangeQuery = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
});

export const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export type CursorQuery = z.infer<typeof cursorQuery>;
export type PageQuery = z.infer<typeof pageQuery>;
