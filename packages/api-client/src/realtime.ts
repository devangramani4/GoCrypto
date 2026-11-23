import type { WsEnvelope, WsEventType, WsSubscribeAck } from '@gocrypto/shared-types';
import { io, type Socket } from 'socket.io-client';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type Handler = (event: WsEnvelope) => void;

export interface RealtimeOptions {
  url: string;
  path?: string;
  getToken: () => string | null | Promise<string | null>;
  onSessionRevoked?: () => void;
}

/**
 * Socket.IO wrapper with reference-counted channel subscriptions. Components subscribe/unsubscribe
 * freely; the server only sees one subscription per channel, and everything is re-subscribed after
 * a reconnect. Private user channels are joined server-side from the access token.
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
  private status: ConnectionStatus = 'disconnected';

  constructor(private readonly opts: RealtimeOptions) {}

  connect(): void {
    if (this.socket) return;
    this.setStatus('connecting');
    this.socket = io(this.opts.url, {
      path: this.opts.path ?? '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      auth: (cb) => {
        void Promise.resolve(this.opts.getToken()).then((token) => cb(token ? { token } : {}));
      },
    });
    this.socket.on('connect', () => {
      this.setStatus('connected');
      const channels = [...this.handlers.keys()].filter((c) => !c.startsWith('user:'));
      if (channels.length) this.socket?.emit('subscribe', { channels });
    });
    this.socket.on('disconnect', () => this.setStatus('disconnected'));
    this.socket.on('connect_error', () => this.setStatus('disconnected'));
    this.socket.on('event', (env: WsEnvelope) => {
      const set = this.handlers.get(env.channel);
      if (set) for (const h of set) h(env);
    });
    this.socket.on('session_revoked', () => this.opts.onSessionRevoked?.());
    this.socket.on('auth_expired', () => void this.refreshAuth());
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus('disconnected');
  }

  /** Re-send the current access token (after a refresh or login) without reconnecting. */
  async refreshAuth(): Promise<boolean> {
    const token = await this.opts.getToken();
    if (!this.socket || !token) return false;
    return new Promise((resolve) =>
      this.socket!.emit('auth', { token }, (r: { ok: boolean }) => resolve(r?.ok ?? false)),
    );
  }

  /** Reconnect so the handshake carries new credentials (login/logout). */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  subscribe<T extends WsEventType>(channel: string, handler: (event: WsEnvelope<T>) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      if (!channel.startsWith('user:'))
        this.socket?.emit('subscribe', { channels: [channel] }, (_ack: WsSubscribeAck) => undefined);
    }
    set.add(handler as Handler);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler as Handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        if (!channel.startsWith('user:')) this.socket?.emit('unsubscribe', { channels: [channel] });
      }
    };
  }

  onStatus(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}
