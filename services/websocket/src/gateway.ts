import type { Server as HttpServer } from 'node:http';
import { USER_CHANNEL_KINDS, type WsSubscribeAck, parseChannel, userChannel } from '@gocrypto/shared-types';
import { type Core, key, metrics } from '@gocrypto/server-core';
import { Server, type Socket } from 'socket.io';

const MAX_SUBSCRIPTIONS = 200;
const MARKET_KINDS = new Set(['ticker', 'orderbook', 'trades', 'mark', 'liquidations']);
const CANDLE_RE = /^candles:(1m|3m|5m|15m|30m|1h|2h|4h|1d|1w|1M)$/;

interface SocketData {
  userId: string | null;
  sessionId: string | null;
  exp: number;
  subs: Set<string>;
}

/**
 * Socket.IO gateway. Every node subscribes to the Redis pattern gc:ws:* and delivers messages to its
 * own local rooms only (no per-user timers, no DB polling). Private user:{id}:* rooms are joined
 * server-side from the verified access token; clients can never subscribe to another user's channel.
 */
export class WsGateway {
  readonly io: Server;
  private sweep: NodeJS.Timeout | null = null;

  constructor(
    private readonly core: Core,
    http: HttpServer,
  ) {
    this.io = new Server(http, {
      path: core.config.WS_PATH,
      cors: {
        origin: (origin, cb) => {
          if (!origin || core.config.CORS_ORIGINS.includes(origin) || (!core.config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
            cb(null, true);
          } else cb(new Error('origin not allowed'), false);
        },
        credentials: true,
      },
      pingInterval: 20_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 64 * 1024,
      transports: ['websocket', 'polling'],
    });
  }

  async start(): Promise<void> {
    this.io.use(async (socket, next) => {
      const data: SocketData = { userId: null, sessionId: null, exp: 0, subs: new Set() };
      socket.data = data;
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      if (token) {
        try {
          await this.authenticate(socket, token);
        } catch {
          return next(new Error('unauthorized'));
        }
      }
      next();
    });
    this.io.on('connection', (socket) => this.onConnection(socket));

    // Fan-out from Redis: one psubscribe per node, local delivery only.
    const sub = this.core.redis.sub;
    const prefix = key('ws', '');
    await sub.psubscribe(`${prefix}*`);
    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const room = channel.slice(prefix.length);
      const members = this.io.sockets.adapter.rooms.get(room);
      if (!members || members.size === 0) return;
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }
      this.io.local.to(room).emit('event', payload);
      metrics.wsMessages.inc({ scope: room.startsWith('user:') ? 'user' : 'market' }, members.size);
    });

    this.core.events.on('session.revoked', ({ userId, sessionIds }) => {
      for (const s of this.io.sockets.sockets.values()) {
        const d = s.data as SocketData;
        if (d.userId === userId && (sessionIds === 'ALL' || (d.sessionId && sessionIds.includes(d.sessionId)))) {
          s.emit('session_revoked');
          s.disconnect(true);
        }
      }
    });
    await this.core.events.start();

    // Single sweep for all sockets: drop private rooms of expired tokens.
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const s of this.io.sockets.sockets.values()) {
        const d = s.data as SocketData;
        if (d.userId && d.exp && d.exp < now) this.deauthenticate(s);
      }
      metrics.wsConnections.set(this.io.engine.clientsCount);
    }, 30_000);
    this.sweep.unref();
  }

  private async authenticate(socket: Socket, token: string): Promise<void> {
    const claims = await this.core.auth.tokens.verifyAccess(token);
    const flags = await this.core.users.flags(claims.userId);
    if (flags.status === 'DISABLED') throw new Error('disabled');
    const d = socket.data as SocketData;
    if (d.userId && d.userId !== claims.userId) this.deauthenticate(socket);
    d.userId = claims.userId;
    d.sessionId = claims.sessionId;
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    d.exp = (payload.exp ?? 0) * 1000;
    for (const kind of USER_CHANNEL_KINDS) void socket.join(userChannel(claims.userId, kind));
  }

  private deauthenticate(socket: Socket): void {
    const d = socket.data as SocketData;
    if (!d.userId) return;
    for (const kind of USER_CHANNEL_KINDS) void socket.leave(userChannel(d.userId, kind));
    d.userId = null;
    d.sessionId = null;
    d.exp = 0;
    socket.emit('auth_expired');
  }

  private validate(socket: Socket, channel: string): boolean {
    if (channel === 'market:all:tickers') return true;
    const p = parseChannel(channel);
    if (!p) return false;
    const d = socket.data as SocketData;
    if (p.scope === 'user') return d.userId === p.id && (USER_CHANNEL_KINDS as readonly string[]).includes(p.kind);
    if (!this.core.markets.bySymbol(p.id)) return false;
    return MARKET_KINDS.has(p.kind) || CANDLE_RE.test(p.kind);
  }

  private onConnection(socket: Socket): void {
    metrics.wsConnections.set(this.io.engine.clientsCount);
    const d = socket.data as SocketData;
    let ops = 0;
    const opsReset = setInterval(() => (ops = 0), 1000);

    socket.on('subscribe', (msg: { channels?: unknown }, ack?: (r: WsSubscribeAck) => void) => {
      if (++ops > 20) return ack?.({ ok: [], denied: ['rate_limited'] });
      const channels = Array.isArray(msg?.channels) ? msg.channels.filter((c): c is string => typeof c === 'string').slice(0, 50) : [];
      const res: WsSubscribeAck = { ok: [], denied: [] };
      for (const c of channels) {
        if (d.subs.size >= MAX_SUBSCRIPTIONS || !this.validate(socket, c)) {
          res.denied.push(c);
          continue;
        }
        void socket.join(c);
        d.subs.add(c);
        res.ok.push(c);
      }
      metrics.wsSubscriptions.inc(res.ok.length);
      ack?.(res);
    });

    socket.on('unsubscribe', (msg: { channels?: unknown }, ack?: (r: WsSubscribeAck) => void) => {
      const channels = Array.isArray(msg?.channels) ? msg.channels.filter((c): c is string => typeof c === 'string') : [];
      for (const c of channels) {
        if (c.startsWith('user:')) continue;
        void socket.leave(c);
        if (d.subs.delete(c)) metrics.wsSubscriptions.dec();
      }
      ack?.({ ok: channels, denied: [] });
    });

    // Re-authenticate after an access-token refresh without reconnecting.
    socket.on('auth', async (msg: { token?: string }, ack?: (r: { ok: boolean }) => void) => {
      try {
        if (!msg?.token) throw new Error('missing');
        await this.authenticate(socket, msg.token);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('disconnect', () => {
      clearInterval(opsReset);
      metrics.wsSubscriptions.dec(d.subs.size);
      metrics.wsConnections.set(this.io.engine.clientsCount);
    });
  }

  get connections(): number {
    return this.io.engine.clientsCount;
  }

  async close(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep);
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}
