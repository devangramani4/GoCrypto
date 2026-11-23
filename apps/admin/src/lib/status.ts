import type {
  DepositStatus,
  MarketStatus,
  OrderStatus,
  SecurityAlertDto,
  ServiceHealthDto,
  UserRole,
  UserStatus,
  WithdrawalStatus,
} from '@gocrypto/shared-types';

export type Tone = 'up' | 'down' | 'warn' | 'brand' | undefined;

/** "PENDING_REVIEW" -> "Pending review", "users.read" -> "Users read". */
export function humanize(code: string): string {
  const s = code.replace(/[_.]+/g, ' ').trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export const USER_STATUS_TONE: Record<UserStatus, Tone> = { ACTIVE: 'up', FROZEN: 'warn', DISABLED: 'down' };

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: 'brand',
  OPEN: 'brand',
  PARTIALLY_FILLED: 'warn',
  FILLED: 'up',
  CANCELLED: undefined,
  REJECTED: 'down',
  EXPIRED: undefined,
};

export const WITHDRAWAL_STATUS_TONE: Record<WithdrawalStatus, Tone> = {
  PENDING_REVIEW: 'warn',
  APPROVED: 'brand',
  PROCESSING: 'brand',
  COMPLETED: 'up',
  REJECTED: 'down',
  FAILED: 'down',
  CANCELLED: undefined,
};

export const DEPOSIT_STATUS_TONE: Record<DepositStatus, Tone> = { PENDING: 'warn', CONFIRMING: 'brand', COMPLETED: 'up', FAILED: 'down' };

export const MARKET_STATUS_TONE: Record<MarketStatus, Tone> = {
  PRE_TRADING: 'brand',
  TRADING: 'up',
  HALTED: 'warn',
  DELISTED: 'down',
  SETTLED: undefined,
};

export const HEALTH_TONE: Record<ServiceHealthDto['status'], Tone> = { UP: 'up', DEGRADED: 'warn', DOWN: 'down' };

export const SEVERITY_TONE: Record<SecurityAlertDto['severity'], Tone> = { LOW: 'brand', MEDIUM: 'warn', HIGH: 'down' };

export const ROLE_TONE: Record<UserRole, Tone> = {
  USER: undefined,
  SUPER_ADMIN: 'down',
  ADMIN: 'brand',
  FINANCE: 'up',
  TRADING_MANAGER: 'brand',
  SUPPORT: 'warn',
  RISK_MANAGER: 'warn',
  VIEW_ONLY: undefined,
};

/** Withdrawal risk score (>= 50 is routed to manual review by the API). */
export function riskTone(score: number): Tone {
  if (score >= 50) return 'down';
  if (score >= 25) return 'warn';
  return 'up';
}

export function toneOf(map: Record<string, Tone>, value: string | null | undefined): Tone {
  return value ? map[value] : undefined;
}
