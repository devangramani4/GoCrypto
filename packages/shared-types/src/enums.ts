/** Runtime-available enum values (string unions + arrays for validation). */

export const MARKET_TYPES = ['SPOT', 'FUTURES', 'OPTIONS'] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

export const ACCOUNT_TYPES = ['SPOT', 'FUTURES', 'OPTIONS'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const ORDER_TYPES = [
  'MARKET',
  'LIMIT',
  'STOP_MARKET',
  'STOP_LIMIT',
  'TAKE_PROFIT_MARKET',
  'TAKE_PROFIT_LIMIT',
] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** GTX = post-only (Good-Till-Crossing). */
export const TIME_IN_FORCE = ['GTC', 'IOC', 'FOK', 'GTX'] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

export const ORDER_STATUSES = [
  'NEW',
  'OPEN',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['NEW', 'OPEN', 'PARTIALLY_FILLED'];
export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'];

export const TRIGGER_STATES = ['NONE', 'PENDING', 'TRIGGERED'] as const;
export type TriggerState = (typeof TRIGGER_STATES)[number];

export const MARKET_STATUSES = ['PRE_TRADING', 'TRADING', 'HALTED', 'DELISTED', 'SETTLED'] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];

export const MARGIN_MODES = ['CROSS', 'ISOLATED'] as const;
export type MarginMode = (typeof MARGIN_MODES)[number];

export const POSITION_SIDES = ['LONG', 'SHORT'] as const;
export type PositionSide = (typeof POSITION_SIDES)[number];

export const OPTION_TYPES = ['CALL', 'PUT'] as const;
export type OptionType = (typeof OPTION_TYPES)[number];

export const USER_ROLES = [
  'USER',
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCE',
  'TRADING_MANAGER',
  'SUPPORT',
  'RISK_MANAGER',
  'VIEW_ONLY',
] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const ADMIN_ROLES: readonly UserRole[] = USER_ROLES.filter((r) => r !== 'USER');

export const USER_STATUSES = ['ACTIVE', 'FROZEN', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PLATFORMS = ['WEB', 'IOS', 'ANDROID', 'DESKTOP', 'API'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const DEPOSIT_STATUSES = ['PENDING', 'CONFIRMING', 'COMPLETED', 'FAILED'] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const WITHDRAWAL_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const TRANSFER_TYPES = ['ACCOUNT', 'USER'] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

export const ORDER_SOURCES = ['WEB', 'MOBILE', 'DESKTOP', 'API', 'SYSTEM', 'LIQUIDATION'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const LEDGER_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL_LOCK',
  'WITHDRAWAL_UNLOCK',
  'WITHDRAWAL',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ORDER_LOCK',
  'ORDER_UNLOCK',
  'TRADE_DEBIT',
  'TRADE_CREDIT',
  'FEE',
  'FEE_REVENUE',
  'MARGIN_LOCK',
  'MARGIN_UNLOCK',
  'REALIZED_PNL',
  'FUNDING_FEE',
  'LIQUIDATION',
  'INSURANCE_FUND',
  'OPTION_PREMIUM',
  'OPTION_SETTLEMENT',
  'ADJUSTMENT',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'ORDER_FILLED',
  'ORDER_PARTIALLY_FILLED',
  'ORDER_CANCELLED',
  'STOP_TRIGGERED',
  'TAKE_PROFIT_TRIGGERED',
  'LIQUIDATION_WARNING',
  'LIQUIDATION',
  'FUNDING',
  'OPTION_SETTLED',
  'DEPOSIT_RECEIVED',
  'WITHDRAWAL_REQUESTED',
  'WITHDRAWAL_PROCESSED',
  'WITHDRAWAL_REJECTED',
  'TRANSFER_RECEIVED',
  'NEW_DEVICE_LOGIN',
  'SECURITY_CHANGE',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CATEGORIES = ['TRADING', 'WALLET', 'SECURITY', 'SYSTEM'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORY_OF: Record<NotificationType, NotificationCategory> = {
  ORDER_FILLED: 'TRADING',
  ORDER_PARTIALLY_FILLED: 'TRADING',
  ORDER_CANCELLED: 'TRADING',
  STOP_TRIGGERED: 'TRADING',
  TAKE_PROFIT_TRIGGERED: 'TRADING',
  LIQUIDATION_WARNING: 'TRADING',
  LIQUIDATION: 'TRADING',
  FUNDING: 'TRADING',
  OPTION_SETTLED: 'TRADING',
  DEPOSIT_RECEIVED: 'WALLET',
  WITHDRAWAL_REQUESTED: 'WALLET',
  WITHDRAWAL_PROCESSED: 'WALLET',
  WITHDRAWAL_REJECTED: 'WALLET',
  TRANSFER_RECEIVED: 'WALLET',
  NEW_DEVICE_LOGIN: 'SECURITY',
  SECURITY_CHANGE: 'SECURITY',
  SYSTEM: 'SYSTEM',
};

export const API_KEY_PERMISSIONS = ['READ', 'TRADE', 'WITHDRAW'] as const;
export type ApiKeyPermission = (typeof API_KEY_PERMISSIONS)[number];

export const ADDRESS_FORMATS = ['BTC', 'EVM', 'TRON', 'SOLANA', 'XRP'] as const;
export type AddressFormatCode = (typeof ADDRESS_FORMATS)[number];

export const SECURITY_ALERT_TYPES = [
  'NEW_DEVICE',
  'FAILED_LOGINS',
  'REFRESH_TOKEN_REUSE',
  'WITHDRAWAL_RISK',
  'PIN_LOCKED',
  'IP_CHANGE',
  'API_KEY_ABUSE',
] as const;
export type SecurityAlertType = (typeof SECURITY_ALERT_TYPES)[number];
