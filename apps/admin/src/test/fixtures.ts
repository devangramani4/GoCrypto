import type { AdminUserDetailDto, AdminUserListItemDto, OffsetPage, Permission } from '@gocrypto/shared-types';

export function page<T>(items: T[], total = items.length, pageNo = 1, pageSize = 25): OffsetPage<T> {
  return { items, total, page: pageNo, pageSize };
}

export const alice: AdminUserListItemDto = {
  id: '101',
  uid: 'GC10000101',
  email: 'alice@example.com',
  displayName: 'Alice Trader',
  role: 'USER',
  status: 'ACTIVE',
  tradingEnabled: true,
  withdrawalsEnabled: true,
  twoFactorEnabled: true,
  emailVerified: true,
  kycLevel: 2,
  vipTier: 1,
  createdAt: Date.UTC(2026, 9, 1, 10, 0, 0),
  lastLoginAt: Date.UTC(2026, 10, 20, 8, 30, 0),
};

export const bob: AdminUserListItemDto = {
  ...alice,
  id: '102',
  uid: 'GC10000102',
  email: 'bob@example.com',
  displayName: null,
  status: 'FROZEN',
  twoFactorEnabled: false,
  kycLevel: 0,
  vipTier: 0,
  lastLoginAt: null,
};

export function userDetail(overrides: Partial<AdminUserDetailDto> = {}): AdminUserDetailDto {
  return {
    ...alice,
    phone: null,
    hasTradingPin: false,
    balances: [{ asset: 'USDT', account: 'SPOT', available: '1500.5', locked: '0', total: '1500.5', usdValue: '1500.5' }],
    openOrders: 2,
    openPositions: 0,
    devices: [],
    sessions: [],
    recentLogins: [],
    ...overrides,
  };
}

export const SUPPORT_PERMISSIONS: Permission[] = ['dashboard.read', 'users.read', 'users.security', 'orders.read', 'wallet.read', 'security.read'];
