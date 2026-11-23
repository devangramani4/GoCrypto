import { z } from 'zod';
import {
  accountTypeSchema,
  assetSymbol,
  cursorQuery,
  email,
  idempotencyKey,
  networkCode,
  otpCode,
  positiveDecimal,
  timeRangeQuery,
  totpCode,
} from './common';

const address = z.string().trim().min(10).max(128);
const memo = z.string().trim().max(64).optional().nullable();

export const withdrawSchema = z.object({
  asset: assetSymbol,
  network: networkCode,
  address,
  memo,
  amount: positiveDecimal,
  pin: z.string().regex(/^\d{6}$/).optional(),
  totpCode: totpCode.optional(),
  emailCode: otpCode.optional(),
  idempotencyKey,
  saveToAddressBook: z.boolean().optional(),
  label: z.string().trim().max(50).optional(),
});

export const accountTransferSchema = z
  .object({
    asset: assetSymbol,
    amount: positiveDecimal,
    from: accountTypeSchema,
    to: accountTypeSchema,
    idempotencyKey: idempotencyKey.optional(),
  })
  .refine((v) => v.from !== v.to, { message: 'Source and destination accounts must differ', path: ['to'] });

export const internalTransferSchema = z.object({
  asset: assetSymbol,
  amount: positiveDecimal,
  /** Recipient email or UID. */
  recipient: z.union([email, z.string().regex(/^\d{8,12}$/, 'Invalid UID')]),
  pin: z.string().regex(/^\d{6}$/).optional(),
  totpCode: totpCode.optional(),
  idempotencyKey,
  note: z.string().trim().max(140).optional(),
});

export const depositAddressQuery = z.object({ asset: assetSymbol, network: networkCode });

export const simulateDepositSchema = z.object({
  asset: assetSymbol,
  network: networkCode,
  amount: positiveDecimal,
});

export const validateAddressSchema = z.object({ network: networkCode, address, memo });

export const addressBookSchema = z.object({
  network: networkCode,
  address,
  memo,
  label: z.string().trim().min(1).max(50),
});

export const walletHistoryQuery = cursorQuery.extend({
  ...timeRangeQuery.shape,
  asset: assetSymbol.optional(),
  account: accountTypeSchema.optional(),
  type: z.string().max(32).optional(),
});

export const withdrawalLimitsQuery = z.object({ asset: assetSymbol, network: networkCode });

export type WithdrawInput = z.infer<typeof withdrawSchema>;
export type AccountTransferInput = z.infer<typeof accountTransferSchema>;
export type InternalTransferInput = z.infer<typeof internalTransferSchema>;
