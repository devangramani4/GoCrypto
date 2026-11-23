import { z } from 'zod';
import { API_KEY_PERMISSIONS, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from '@gocrypto/shared-types';
import { backupCode, deviceId, email, otpCode, password, phone, pinCode, platformSchema, totpCode } from './common';

const deviceInfo = {
  deviceId: deviceId.optional(),
  deviceName: z.string().trim().max(100).optional(),
  platform: platformSchema.optional(),
};

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(2).max(50).optional(),
  phone: phone.optional(),
  referralCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{4,16}$/)
    .optional(),
  acceptTerms: z.literal(true, { error: 'You must accept the terms' }),
  ...deviceInfo,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  ...deviceInfo,
});

export const loginMfaSchema = z
  .object({
    mfaToken: z.string().min(20).max(2048),
    code: totpCode.optional(),
    backupCode: backupCode.optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.backupCode), {
    message: 'Provide either a 2FA code or a backup code',
    path: ['code'],
  });

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(4096) });
export const logoutSchema = z.object({ refreshToken: z.string().min(20).max(4096).optional() });

export const verifyEmailSchema = z.object({ code: otpCode });
export const sendPhoneOtpSchema = z.object({ phone });
export const verifyPhoneSchema = z.object({ phone, code: otpCode });

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ email, code: otpCode, newPassword: password });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password,
    totpCode: totpCode.optional(),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });

export const googleAuthSchema = z.object({ idToken: z.string().min(20).max(8192), ...deviceInfo });
export const appleAuthSchema = z.object({
  identityToken: z.string().min(20).max(8192),
  nonce: z.string().max(256).optional(),
  fullName: z.string().trim().max(100).optional(),
  ...deviceInfo,
});

export const enableTwoFactorSchema = z.object({ code: totpCode });
export const disableTwoFactorSchema = z.object({ code: totpCode, password: z.string().min(1).max(128) });

export const setPinSchema = z.object({ pin: pinCode, password: z.string().min(1).max(128) });
export const changePinSchema = z.object({ currentPin: z.string().regex(/^\d{6}$/), newPin: pinCode });
export const verifyPinSchema = z.object({ pin: z.string().regex(/^\d{6}$/) });

export const updateDeviceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  trusted: z.boolean().optional(),
});

export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(512),
  provider: z.enum(['FCM', 'APNS', 'WEB']),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(50).optional(),
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
  antiPhishingCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4,20}$/)
    .optional(),
});

const channelPrefs = z.object(
  Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, z.boolean()])) as Record<
    (typeof NOTIFICATION_CHANNELS)[number],
    z.ZodBoolean
  >,
);

export const userSettingsSchema = z.object({
  notificationPrefs: z
    .object(
      Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, channelPrefs.partial()])) as Record<
        (typeof NOTIFICATION_CATEGORIES)[number],
        ReturnType<typeof channelPrefs.partial>
      >,
    )
    .partial()
    .optional(),
  locale: z.string().max(10).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  confirmOrders: z.boolean().optional(),
});

export const createApiKeySchema = z.object({
  label: z.string().trim().min(1).max(50),
  permissions: z.array(z.enum(API_KEY_PERMISSIONS)).min(1).max(3),
  ipWhitelist: z
    .array(z.union([z.ipv4(), z.ipv6()]))
    .max(20)
    .default([]),
  totpCode: totpCode.optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type LoginMfaInput = z.infer<typeof loginMfaSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type UserSettingsInput = z.infer<typeof userSettingsSchema>;
