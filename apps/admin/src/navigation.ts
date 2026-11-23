import type { IconName } from '@gocrypto/ui';
import { type PermissionRequirement, hasPermission } from './lib/permissions';
import type { Permission } from '@gocrypto/shared-types';

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Holding ANY of these permissions shows the item and unlocks the route. */
  perm: PermissionRequirement;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: 'grid', perm: 'dashboard.read' },
      { path: '/system', label: 'System health', icon: 'server', perm: 'system.read' },
    ],
  },
  {
    label: 'Customers',
    items: [{ path: '/users', label: 'Users', icon: 'users', perm: 'users.read' }],
  },
  {
    label: 'Trading',
    items: [
      { path: '/markets', label: 'Markets', icon: 'candles', perm: 'markets.read' },
      { path: '/orders', label: 'Orders & trades', icon: 'list', perm: ['orders.read', 'risk.read'] },
      { path: '/fees', label: 'Fees', icon: 'dollar', perm: 'fees.read' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { path: '/wallet', label: 'Wallet', icon: 'wallet', perm: 'wallet.read' },
      { path: '/reports', label: 'Reports', icon: 'pie', perm: 'reports.read' },
    ],
  },
  {
    label: 'Risk & compliance',
    items: [
      { path: '/security', label: 'Security', icon: 'shield', perm: 'security.read' },
      { path: '/audit', label: 'Audit logs', icon: 'file', perm: 'audit.read' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { path: '/roles', label: 'Roles & permissions', icon: 'key', perm: 'roles.read' },
      { path: '/settings', label: 'Settings', icon: 'settings', perm: 'settings.read' },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Sections filtered down to the items the admin may open (empty sections removed). */
export function visibleSections(granted: ReadonlySet<Permission>): NavSection[] {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => hasPermission(granted, i.perm)) })).filter((s) => s.items.length > 0);
}

/** Landing route: the first page the admin is allowed to open. */
export function firstAllowedPath(granted: ReadonlySet<Permission>): string | null {
  return NAV_ITEMS.find((i) => hasPermission(granted, i.perm))?.path ?? null;
}

export function navItemForPath(pathname: string): { section: NavSection; item: NavItem } | null {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (pathname === item.path || pathname.startsWith(`${item.path}/`)) return { section, item };
    }
  }
  return null;
}
