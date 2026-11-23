import { ALL_PERMISSIONS, USER_ROLES, type Permission, type UserRole } from '@gocrypto/shared-types';
import { create } from 'zustand';

export interface AdminIdentity {
  userId: string;
  role: UserRole;
  permissions: Permission[];
}

export type SessionStatus = 'restoring' | 'anonymous' | 'authenticated';

export interface SessionNotice {
  tone: 'info' | 'error';
  message: string;
}

interface SessionState {
  status: SessionStatus;
  admin: AdminIdentity | null;
  /** Message shown on the login screen (session expired, not staff, ...). */
  notice: SessionNotice | null;
  signIn: (admin: AdminIdentity) => void;
  signOut: (notice?: SessionNotice | null) => void;
  /** Called by the API client when the refresh token is rejected. No-op unless signed in. */
  expire: () => void;
  clearNotice: () => void;
}

const initial = { status: 'restoring' as SessionStatus, admin: null, notice: null };

export const useSession = create<SessionState>()((set, get) => ({
  ...initial,
  signIn: (admin) => set({ status: 'authenticated', admin, notice: null }),
  signOut: (notice = null) => set({ status: 'anonymous', admin: null, notice }),
  expire: () => {
    if (get().status !== 'authenticated') return;
    set({ status: 'anonymous', admin: null, notice: { tone: 'info', message: 'Your session has expired. Sign in again to continue.' } });
  },
  clearNotice: () => set({ notice: null }),
}));

/** Reset to the boot state (tests). */
export function resetSession(): void {
  useSession.setState({ ...initial });
}

const ROLE_SET = new Set<string>(USER_ROLES);
const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/** Narrow the untyped `/admin/me` payload into a typed identity (unknown permissions are dropped). */
export function toAdminIdentity(me: { userId: string; role: string; permissions: readonly string[] }): AdminIdentity {
  const role = (ROLE_SET.has(me.role) ? me.role : 'VIEW_ONLY') as UserRole;
  return {
    userId: String(me.userId),
    role,
    permissions: me.permissions.filter((p): p is Permission => PERMISSION_SET.has(p)),
  };
}
