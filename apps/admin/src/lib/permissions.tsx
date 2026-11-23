import type { Permission } from '@gocrypto/shared-types';
import { type ReactNode, useCallback, useMemo } from 'react';
import { useSession } from './session';

/** A single permission, or a list where holding ANY of them is sufficient. */
export type PermissionRequirement = Permission | readonly Permission[];

export function hasPermission(granted: ReadonlySet<Permission>, required?: PermissionRequirement): boolean {
  if (required === undefined) return true;
  if (typeof required === 'string') return granted.has(required);
  return required.length === 0 || required.some((p) => granted.has(p));
}

export function requirementLabel(required: PermissionRequirement): string {
  return typeof required === 'string' ? required : required.join(' or ');
}

const EMPTY: readonly Permission[] = [];

export function usePermissions(): ReadonlySet<Permission> {
  const perms = useSession((s) => s.admin?.permissions ?? EMPTY);
  return useMemo(() => new Set(perms), [perms]);
}

/** `can('users.freeze')` / `can(['orders.read', 'risk.read'])` */
export function useCan(): (required?: PermissionRequirement) => boolean {
  const perms = usePermissions();
  return useCallback((required?: PermissionRequirement) => hasPermission(perms, required), [perms]);
}

export function Can({ perm, children, fallback = null }: { perm: PermissionRequirement; children: ReactNode; fallback?: ReactNode }) {
  const can = useCan();
  return <>{can(perm) ? children : fallback}</>;
}
