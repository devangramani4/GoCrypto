import type { FuturesPositionDto, NotificationDto, NotificationType, WsPositionEvent } from '@gocrypto/shared-types';
import { userChannel } from '@gocrypto/shared-types';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { signOf } from '../lib/format';
import { haptics } from '../lib/haptics';
import { onForegroundPush, onPushOpened, onPushTokenRefresh, registerForPushNotifications } from '../lib/push';
import { createBatchedInvalidator } from '../lib/queryClient';
import { qk } from '../lib/queryKeys';
import { realtime } from '../lib/realtime';
import { openNotificationTarget } from '../navigation/navigationRef';
import { useSession } from '../store/session';
import { toast, type ToastType } from '../store/toast';
import { useMe } from './useCommon';

function toastTypeFor(type: NotificationType): ToastType {
  switch (type) {
    case 'ORDER_FILLED':
    case 'ORDER_PARTIALLY_FILLED':
    case 'TAKE_PROFIT_TRIGGERED':
    case 'DEPOSIT_RECEIVED':
    case 'WITHDRAWAL_PROCESSED':
    case 'TRANSFER_RECEIVED':
    case 'OPTION_SETTLED':
      return 'success';
    case 'LIQUIDATION':
    case 'WITHDRAWAL_REJECTED':
      return 'error';
    case 'LIQUIDATION_WARNING':
    case 'STOP_TRIGGERED':
    case 'NEW_DEVICE_LOGIN':
    case 'SECURITY_CHANGE':
      return 'warning';
    default:
      return 'info';
  }
}

function applyPositionEvent(qc: QueryClient, ev: WsPositionEvent): void {
  if (ev.marketType !== 'FUTURES') return;
  qc.setQueryData<FuturesPositionDto[]>(qk.positions, (old) => {
    if (!old) return old;
    const rest = old.filter((p) => p.symbol !== ev.symbol);
    const next = ev.futures;
    return next && signOf(next.quantity) !== 0 ? [next, ...rest] : rest;
  });
}

function showNotificationToast(n: NotificationDto): void {
  const type = toastTypeFor(n.type);
  if (type === 'success') haptics.success();
  else if (type === 'warning') haptics.warning();
  else if (type === 'error') haptics.error();
  toast.show({
    type,
    title: n.title,
    message: n.body,
    onPress: () => openNotificationTarget({ ...(n.data ?? {}), type: n.type }),
  });
}

/**
 * Private realtime channels → React Query caches. Events only signal that something changed; the
 * authoritative state is re-fetched from the API (batched), positions are patched in place.
 */
function useUserRealtimeSync(userId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return undefined;
    const invalidate = createBatchedInvalidator(qc);
    const subs = [
      realtime.subscribe(userChannel(userId, 'orders'), () => {
        invalidate(qk.orders);
        invalidate(qk.portfolioSummary);
      }),
      realtime.subscribe(userChannel(userId, 'trades'), () => {
        invalidate(qk.fills);
      }),
      realtime.subscribe(userChannel(userId, 'balance'), () => {
        invalidate(qk.wallet);
        invalidate(qk.portfolio);
        invalidate(qk.futuresAccount);
      }),
      realtime.subscribe(userChannel(userId, 'positions'), (env) => {
        if (env.type === 'position') applyPositionEvent(qc, env.data as WsPositionEvent);
        invalidate(qk.futuresAccount);
        invalidate(qk.portfolio);
      }),
      realtime.subscribe(userChannel(userId, 'notifications'), (env) => {
        if (env.type !== 'notification') return;
        showNotificationToast(env.data as NotificationDto);
        invalidate(qk.notifications);
      }),
      realtime.subscribe(userChannel(userId, 'liquidations'), () => {
        invalidate(qk.futures);
        invalidate(qk.wallet);
      }),
    ];
    return () => {
      for (const unsubscribe of subs) unsubscribe();
      invalidate.cancel();
    };
  }, [userId, qc]);
}

/** Registers this device for push once per signed-in user, and again if the OS rotates the token. */
function usePushRegistration(userId: string | undefined): void {
  const registeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return undefined;
    const register = () => {
      registerForPushNotifications()
        .then((r) => {
          if (r.status === 'registered') registeredFor.current = userId;
        })
        .catch((e: unknown) => {
          if (__DEV__) console.warn('[push] registration failed', e);
        });
    };
    if (registeredFor.current !== userId) register();
    return onPushTokenRefresh(register);
  }, [userId]);
}

/** Push taps: route to the related screen (also handles the tap that launched the app). */
function useNotificationResponses(): void {
  useEffect(() => onPushOpened((data) => openNotificationTarget(data)), []);
}

/** Pushes received while the app is open but the socket is down: same in-app toast as socket events. */
function useForegroundPushes(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      onForegroundPush((title, body, data) => {
        toast.show({ type: 'info', title, message: body, onPress: () => openNotificationTarget(data) });
        void qc.invalidateQueries({ queryKey: qk.notifications });
      }),
    [qc],
  );
}

/** Pauses the socket after 30 s in the background and resumes it in the foreground. */
export function useRealtimeLifecycle(): void {
  useEffect(() => {
    realtime.connect();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (timer) clearTimeout(timer);
        timer = null;
        realtime.connect();
      } else if (state === 'background') {
        timer ??= setTimeout(() => {
          timer = null;
          realtime.disconnect();
        }, 30_000);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);
}

/** Everything that runs while a user is signed in. Renders nothing. */
export function SignedInEffects(): null {
  const userId = useSession((s) => s.user?.id);
  useMe();
  useUserRealtimeSync(userId);
  usePushRegistration(userId);
  useNotificationResponses();
  useForegroundPushes();
  return null;
}
