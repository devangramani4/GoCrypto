import type { UserRole } from './enums';

/**
 * Admin permission catalogue. Role -> permission assignments are stored in the database and are
 * editable by SUPER_ADMIN; DEFAULT_ROLE_PERMISSIONS is only the initial seed.
 */
export const PERMISSIONS = {
  'dashboard.read': 'View admin dashboard',
  'users.read': 'View users and user details',
  'users.write': 'Edit user profile, tiers and flags',
  'users.freeze': 'Freeze / unfreeze accounts',
  'users.trading': 'Enable / disable trading for a user',
  'users.security': 'Reset user security (2FA, PIN, sessions)',
  'users.roles': 'Assign admin roles to users',
  'markets.read': 'View markets and contracts',
  'markets.write': 'Create and edit spot, futures and options markets',
  'risk.read': 'View risk limits, positions and liquidations',
  'risk.write': 'Edit leverage settings and risk limits',
  'fees.read': 'View fee schedules',
  'fees.write': 'Edit trading and withdrawal fees',
  'orders.read': 'Monitor orders and trades',
  'orders.cancel': 'Cancel user orders',
  'wallet.read': 'View deposits, withdrawals and balances',
  'withdrawals.review': 'Approve or reject withdrawals',
  'wallet.adjust': 'Manual balance adjustments (sandbox)',
  'reports.read': 'Financial reports and revenue',
  'security.read': 'Login activity, suspicious activity, IP and device monitoring',
  'security.write': 'Resolve security alerts',
  'audit.read': 'View audit logs',
  'roles.read': 'View roles and permissions',
  'roles.write': 'Edit role permissions',
  'settings.read': 'View system settings',
  'settings.write': 'Edit system settings',
  'system.read': 'View system health and monitoring',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const READ_ALL: Permission[] = ALL_PERMISSIONS.filter((p) => p.endsWith('.read'));

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  USER: [],
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  ADMIN: ALL_PERMISSIONS.filter((p) => !['roles.write', 'settings.write', 'wallet.adjust'].includes(p)),
  FINANCE: [
    'dashboard.read',
    'users.read',
    'wallet.read',
    'withdrawals.review',
    'reports.read',
    'fees.read',
    'fees.write',
    'audit.read',
  ],
  TRADING_MANAGER: [
    'dashboard.read',
    'users.read',
    'users.trading',
    'markets.read',
    'markets.write',
    'fees.read',
    'fees.write',
    'orders.read',
    'orders.cancel',
    'risk.read',
  ],
  SUPPORT: ['dashboard.read', 'users.read', 'users.security', 'orders.read', 'wallet.read', 'security.read'],
  RISK_MANAGER: [
    'dashboard.read',
    'users.read',
    'users.freeze',
    'users.trading',
    'markets.read',
    'risk.read',
    'risk.write',
    'orders.read',
    'orders.cancel',
    'wallet.read',
    'withdrawals.review',
    'security.read',
    'security.write',
  ],
  VIEW_ONLY: READ_ALL.filter((p) => p !== 'audit.read'),
};
