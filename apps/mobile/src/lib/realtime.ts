import { RealtimeClient, type ConnectionStatus } from '@gocrypto/api-client';
import type { WsEnvelope, WsEventType, WsPayloads } from '@gocrypto/shared-types';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { config } from '../config';
import { authEvents, getFreshAccessToken } from './api';

type Listener = () => void;
const revokedListeners = new Set<Listener>();

/**
 * Single Socket.IO connection for the app. Public market channels work signed-out; private
 * `user:<id>:*` rooms are joined server-side from the access token sent in the handshake / `auth`.
 */
export const realtime = new RealtimeClient({
  url: config.wsUrl,
  path: config.wsPath,
  getToken: () => getFreshAccessToken(),
  onSessionRevoked: () => {
    for (const l of revokedListeners) l();
  },
});

export function onRealtimeSessionRevoked(listener: Listener): () => void {
  revokedListeners.add(listener);
  return () => {
    revokedListeners.delete(listener);
  };
}

// Keep the socket's identity in sync with the HTTP session.
let reauthPending = false;

function reauthenticate(): void {
  reauthPending = false;
  void realtime.refreshAuth().then((ok) => {
    if (!ok) realtime.reconnect();
  });
}

authEvents.onTokens((tokens) => {
  const status = realtime.connectionStatus;
  if (tokens) {
    // Login or token rotation: re-authenticate the live socket (joins user rooms) without reconnecting.
    // A handshake that is still in flight may have been sent with the old/no token: redo it once connected.
    if (status === 'connected') reauthenticate();
    else if (status === 'connecting') reauthPending = true;
  } else if (status !== 'disconnected') {
    // Logout: drop private rooms by reconnecting anonymously.
    reauthPending = false;
    realtime.reconnect();
  }
});

realtime.onStatus((status) => {
  if (status === 'connected' && reauthPending) reauthenticate();
});

/** Live connection status ('connecting' | 'connected' | 'disconnected'). */
export function useRealtimeStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (onChange) => realtime.onStatus(() => onChange()),
    () => realtime.connectionStatus,
  );
}

/**
 * Subscribe to one channel/event type for the lifetime of the component. The handler can change
 * between renders without re-subscribing. Pass `null` to skip.
 */
export function useChannel<T extends WsEventType>(
  channel: string | null | undefined,
  type: T,
  handler: (data: WsPayloads[T], envelope: WsEnvelope) => void,
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!channel) return undefined;
    return realtime.subscribe(channel, (env: WsEnvelope) => {
      if (env.type === type) ref.current(env.data as WsPayloads[T], env);
    });
  }, [channel, type]);
}
