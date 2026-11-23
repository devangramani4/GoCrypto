import { z } from 'zod';
import {
  ALL_PERMISSIONS,
  MARKET_STATUSES,
  OPTION_TYPES,
  USER_ROLES,
  USER_STATUSES,
  WITHDRAWAL_STATUSES,
  type Permission,
} from '@gocrypto/shared-types';
import {
  accountTypeSchema,
  assetSymbol,
  decimalString,
  marketTypeSchema,
  networkCode,
  pageQuery,
  positiveDecimal,
  symbolSchema,
  timeRangeQuery,
} from './common';

const reason = z.string().trim().min(3).max(500);
const rate = decimalString.refine((v) => Number(v) < 0.1, 'Fee rate must be below 10%');

export const adminUserListQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
});

export const adminUpdateUserSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  vipTier: z.number().int().min(0).max(9).optional(),
  kycLevel: z.number().int().min(0).max(3).optional(),
  withdrawalsEnabled: z.boolean().optional(),
  displayName: z.string().trim().min(2).max(50).optional(),
});

export const adminReasonSchema = z.object({ reason });

export const adminResetSecuritySchema = z.object({
  reason,
  resetTwoFactor: z.boolean().default(true),
  resetPin: z.boolean().default(true),
  revokeSessions: z.boolean().default(true),
});

export const adminAdjustBalanceSchema = z.object({
  asset: assetSymbol,
  account: accountTypeSchema,
  amount: z.string().regex(/^-?\d+(\.\d+)?$/),
  reason,
});

const filtersShape = {
  tickSize: positiveDecimal,
  stepSize: positiveDecimal,
  minQty: positiveDecimal,
  maxQty: positiveDecimal,
  minNotional: decimalString,
  priceBand: decimalString.optional(),
  makerFeeRate: rate.optional().nullable(),
  takerFeeRate: rate.optional().nullable(),
};

export const adminCreateSpotMarketSchema = z.object({
  base: assetSymbol,
  quote: assetSymbol,
  ...filtersShape,
  status: z.enum(MARKET_STATUSES).default('TRADING'),
});

export const adminCreateFuturesMarketSchema = z.object({
  underlying: assetSymbol,
  settleAsset: assetSymbol.default('USDT'),
  ...filtersShape,
  maxLeverage: z.number().int().min(1).max(125),
  defaultLeverage: z.number().int().min(1).max(125).default(20),
  fundingIntervalHours: z.number().int().min(1).max(24).default(8),
  status: z.enum(MARKET_STATUSES).default('TRADING'),
});

export const adminCreateOptionSchema = z.object({
  underlying: assetSymbol,
  optionType: z.enum(OPTION_TYPES),
  strike: positiveDecimal,
  expiry: z.number().int().positive(),
});

export const adminUpdateMarketSchema = z.object({
  status: z.enum(MARKET_STATUSES).optional(),
  tickSize: positiveDecimal.optional(),
  stepSize: positiveDecimal.optional(),
  minQty: positiveDecimal.optional(),
  maxQty: positiveDecimal.optional(),
  minNotional: decimalString.optional(),
  priceBand: decimalString.optional(),
  makerFeeRate: rate.optional().nullable(),
  takerFeeRate: rate.optional().nullable(),
  maxLeverage: z.number().int().min(1).max(125).optional(),
  defaultLeverage: z.number().int().min(1).max(125).optional(),
});

export const adminRiskTiersSchema = z.object({
  tiers: z
    .array(
      z.object({
        tier: z.number().int().min(1),
        maxNotional: positiveDecimal,
        maxLeverage: z.number().int().min(1).max(125),
        maintenanceMarginRate: positiveDecimal,
        maintenanceAmount: decimalString,
      }),
    )
    .min(1)
    .max(20),
});

export const adminFeeScheduleSchema = z.object({
  fees: z
    .array(
      z.object({
        marketType: marketTypeSchema,
        vipTier: z.number().int().min(0).max(9),
        makerRate: z.string().regex(/^-?\d+(\.\d+)?$/),
        takerRate: rate,
      }),
    )
    .min(1),
});

export const adminUserFeeSchema = z.object({
  marketType: marketTypeSchema,
  makerRate: z.string().regex(/^-?\d+(\.\d+)?$/),
  takerRate: rate,
  expiresAt: z.number().int().positive().nullable().optional(),
});

export const adminAssetNetworkSchema = z.object({
  depositEnabled: z.boolean().optional(),
  withdrawEnabled: z.boolean().optional(),
  withdrawalFee: decimalString.optional(),
  minWithdrawal: decimalString.optional(),
  minDeposit: decimalString.optional(),
  confirmations: z.number().int().min(1).max(1000).optional(),
});

export const adminWithdrawalQuery = pageQuery.extend({
  status: z.enum(WITHDRAWAL_STATUSES).optional(),
  asset: assetSymbol.optional(),
  userId: z.string().regex(/^\d+$/).optional(),
});

export const adminReviewWithdrawalSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});

export const adminOrdersQuery = pageQuery.extend({
  ...timeRangeQuery.shape,
  userId: z.string().regex(/^\d+$/).optional(),
  symbol: symbolSchema.optional(),
  marketType: marketTypeSchema.optional(),
  status: z.string().max(20).optional(),
});

export const adminReportQuery = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});

export const adminRolePermissionsSchema = z.object({
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
});

export const adminSettingsSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.]{2,63}$/),
  value: z.unknown(),
});

export const adminListQuery = pageQuery.extend({
  ...timeRangeQuery.shape,
  q: z.string().trim().max(100).optional(),
  userId: z.string().regex(/^\d+$/).optional(),
  type: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
  network: networkCode.optional(),
});
