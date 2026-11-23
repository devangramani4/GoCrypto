import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { haptics } from '../lib/haptics';
import { qk } from '../lib/queryKeys';
import { useSession } from '../store/session';

/** Pull-to-refresh state that only reflects user-initiated refreshes (not background refetches). */
export function useRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const ref = useRef(refetch);
  useEffect(() => {
    ref.current = refetch;
  });
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    haptics.light();
    void Promise.resolve()
      .then(() => ref.current())
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, []);
  return { refreshing, onRefresh };
}

/**
 * Remembers the last non-null value, so a sheet driven by `selected !== null` keeps its content
 * while its closing animation runs.
 */
export function useLastNonNull<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}

/** Re-renders every `intervalMs` (countdowns, relative times). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Seconds left on a resend cooldown (e-mail / SMS codes). */
export function useCooldown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  const until = useRef(0);
  const active = left > 0;
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      setLeft(Math.max(0, Math.ceil((until.current - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);
  const start = useCallback((seconds: number) => {
    until.current = Date.now() + seconds * 1000;
    setLeft(seconds);
  }, []);
  return [left, start];
}

/** Signed-in user's profile (kept fresh; mirrors into the session store). */
export function useMe() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      const me = await api.users.me();
      useSession.getState().setUser(me);
      return me;
    },
    enabled: signedIn,
    staleTime: 60_000,
    initialData: () => useSession.getState().user ?? undefined,
    initialDataUpdatedAt: 0,
  });
}

export function useUnreadCount() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  return useQuery({
    queryKey: qk.unreadCount,
    queryFn: () => api.notifications.unreadCount(),
    select: (d) => d.count,
    enabled: signedIn,
    refetchInterval: 120_000,
  });
}
