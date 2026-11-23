import type { Server as HttpServer } from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import {
  type TickerDto,
  USER_CHANNEL_KINDS,
  type WsEnvelope,
  type WsSubscribeAck,
  parseChannel,
  userChannel,
} from '@gocrypto/shared-types';
import { type Core, type Redis, metrics, wsRedisChannel } from '@gocrypto/server-core';
import { Server, type Socket } from 'socket.io';

const MAX_SUBSCRIPTIONS = 200;
const MAX_OPS_PER_SECOND = 20;
const MARKET_KINDS = new Set(['ticker', 'orderbook', 'trades', 'mark', 'liquidations']);
const CANDLE_RE = /^candles:(1m|3m|5m|15m|30m|1h|2h|4h|1d|1w|1M)$/;
/** Full-state market updates: while one is still waiting to be sent, a newer one replaces it. */
const SNAPSHOT_TYPES = new Set(['orderbook', 'ticker', 'mark']);
/** Fan-out work per macrotask, so handshakes, pings and timers keep running while the gateway is busy. */
const SLICE_MS = 10;
/** Trades kept when batches merge (clients show the latest few dozen; REST keeps the last 200 too). */
const MAX_MERGED_TRADES = 200;

/** Bytes queued for a client but not yet handed to the kernel (engine.io → ws). */
function backlogBytes(socket: Socket): number {
  const ws = (socket.conn as unknown as { transport?: { socket?: { bufferedAmount?: number } } }).transport?.socket;
  return typeof ws?.bufferedAmount === 'number' ? ws.bufferedAmount : 0;
}

interface SocketData {
  userId: string | null;
  sessionId: string | null;
  exp: number;
  subs: Set<string>;
  /** Fixed one-second window for subscribe/unsubscribe rate limiting (no per-socket timers). */
  opsWindowStart: number;
  ops: number;
}

/**
 * Socket.IO gateway.
 *
 * Fan-out is targeted: a node SUBSCRIBEs to a Redis channel only while it hosts a room that needs it
 * (market rooms map 1:1, all private rooms of a user share gc:ws:u:{id}), so adding gateway nodes does
 * not multiply the traffic every node has to process. Private user rooms are joined server-side from
 * the verified access token; clients can never subscribe to another user's channels. There are no
 * per-connection timers and session revocation is O(sockets of that user).
 *
 * Overload protection: a node refuses new handshakes when it is full (WS_MAX_CONNECTIONS) or its event
 * loop is lagging (WS_SHED_LOOP_DELAY_MS) — clients retry with backoff and the load balancer, told by
 * /ready, sends them to other nodes — and it disconnects clients that stop reading instead of buffering
 * for them without bound.
 */
export class WsGateway {
  readonly io: Server;
  private sweep: NodeJS.Timeout | null = null;
  private loadTimer: NodeJS.Timeout | null = null;
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 20 });
  private shedding = false;
  /** Event-loop delay p99 over the last second (ms). */
  loopDelayP99Ms = 0;
  /** CPU used by this process over the last second, in cores (process time, immune to host contention). */
  cpuCores = 0;
  /** Updates waiting to be fanned out, per channel in arrival order (bounded by coalescing, see enqueue). */
  private readonly pending = new Map<string, WsEnvelope[]>();
  private draining = false;
  private fanout: Redis | null = null;
  /** Redis channel -> number of local rooms relying on it. */
  private readonly redisRefs = new Map<string, number>();
  /** Authenticated local sockets per user (session revocation, metrics). */
  private readonly socketsByUser = new Map<string, Set<Socket>>();

  constructor(
    private readonly core: Core,
    http: HttpServer,
  ) {
    this.io = new Server(http, {
      path: core.config.WS_PATH,
      cors: {
        origin: (origin, cb) => {
          if (
            !origin ||
            core.config.CORS_ORIGINS.includes(origin) ||
            (!core.config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
          ) {
            cb(null, true);
          } else cb(new Error('origin not allowed'), false);
        },
        credentials: true,
      },
      pingInterval: 25_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 64 * 1024,
      // Websocket only: HTTP long-polling would need sticky sessions across gateway replicas.
      transports: ['websocket'],
      perMessageDeflate: false,
      allowRequest: (_req, cb) => (this.admitting ? cb(null, true) : cb('server busy', false)),
    });
  }

  /** Whether this node accepts new connections (also drives /ready). */
  get admitting(): boolean {
    return !this.shedding && this.io.engine.clientsCount < this.core.config.WS_MAX_CONNECTIONS;
  }

  async start(): Promise<void> {
    this.io.use(async (socket, next) => {
      const data: SocketData = { userId: null, sessionId: null, exp: 0, subs: new Set(), opsWindowStart: 0, ops: 0 };
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

    const fanout = this.core.redis.blocking('ws-fanout');
    this.fanout = fanout;
    fanout.on('message', (_channel: string, message: string) => this.enqueue(message));
    const adapter = this.io.of('/').adapter;
    adapter.on('create-room', (room: string) => this.retain(room));
    adapter.on('delete-room', (room: string) => this.release(room));

    this.core.events.on('session.revoked', ({ userId, sessionIds }) => {
      const sockets = this.socketsByUser.get(userId);
      if (!sockets) return;
      for (const s of [...sockets]) {
        const d = s.data as SocketData;
        if (sessionIds === 'ALL' || (d.sessionId && sessionIds.includes(d.sessionId))) {
          s.emit('session_revoked');
          s.disconnect(true);
        }
      }
    });
    await this.core.events.start();

    // Single sweep for all sockets: drop private rooms of expired tokens, evict clients that stopped reading.
    let tick = 0;
    this.sweep = setInterval(() => {
      const now = Date.now();
      if (++tick % 6 === 0) {
        for (const sockets of this.socketsByUser.values()) {
          for (const s of sockets) {
            const d = s.data as SocketData;
            if (d.exp && d.exp < now) this.deauthenticate(s);
          }
        }
      }
      let evicted = 0;
      for (const s of this.io.sockets.sockets.values()) {
        if (backlogBytes(s) > this.core.config.WS_SLOW_CONSUMER_BYTES) {
          s.disconnect(true);
          evicted += 1;
        }
      }
      if (evicted) this.core.log.warn({ evicted }, 'disconnected websocket clients that stopped reading');
      metrics.wsConnections.set(this.io.engine.clientsCount);
    }, 5_000);
    this.sweep.unref();

    this.loopDelay.enable();
    let lastTick = performance.now();
    let lastCpu = process.cpuUsage();
    let hot = 0;
    let cool = 0;
    this.loadTimer = setInterval(() => {
      const now = performance.now();
      const wallMs = Math.max(1, now - lastTick);
      // A loop blocked for the whole window records no samples; the timer's own lateness still shows it.
      const drift = Math.max(0, wallMs - 1_000);
      lastTick = now;
      const p99 = this.loopDelay.percentile(99) / 1e6;
      this.loopDelayP99Ms = Math.max(Number.isFinite(p99) ? p99 : 0, drift);
      this.loopDelay.reset();
      // Coalescing keeps the loop responsive even at full load, so the process's own CPU time is the
      // saturation signal (wall-clock busy time would also count time the OS gave to other processes).
      const cpu = process.cpuUsage();
      this.cpuCores = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1_000 / wallMs;
      lastCpu = cpu;
      const saturated =
        this.cpuCores > this.core.config.WS_SHED_CPU || this.loopDelayP99Ms > this.core.config.WS_SHED_LOOP_DELAY_MS;
      hot = saturated ? hot + 1 : 0;
      cool = saturated ? 0 : cool + 1;
      const shedding = this.shedding ? cool < 5 : hot >= 3;
      if (shedding !== this.shedding) {
        this.core.log.warn(
          {
            loopDelayP99Ms: Math.round(this.loopDelayP99Ms),
            cpuCores: Math.round(this.cpuCores * 100) / 100,
            connections: this.connections,
          },
          shedding
            ? 'websocket gateway overloaded: refusing new connections'
            : 'websocket gateway accepting connections again',
        );
      }
      this.shedding = shedding;
    }, 1_000);
    this.loadTimer.unref();
  }

  // ───────────────────────── fan-out ─────────────────────────

  private redisChannelOf(room: string): string | null {
    // Every socket also sits in a room named after its id; only channel rooms are backed by Redis.
    if (!room.startsWith('market:') && !room.startsWith('user:')) return null;
    return wsRedisChannel(room);
  }

  private retain(room: string): void {
    const ch = this.redisChannelOf(room);
    if (!ch) return;
    const n = (this.redisRefs.get(ch) ?? 0) + 1;
    this.redisRefs.set(ch, n);
    if (n === 1) {
      this.fanout
        ?.subscribe(ch)
        .catch((err: Error) => this.core.log.warn({ err: err.message, ch }, 'ws subscribe failed'));
    }
  }

  private release(room: string): void {
    const ch = this.redisChannelOf(room);
    if (!ch) return;
    const n = (this.redisRefs.get(ch) ?? 0) - 1;
    if (n > 0) {
      this.redisRefs.set(ch, n);
      return;
    }
    this.redisRefs.delete(ch);
    this.fanout
      ?.unsubscribe(ch)
      .catch((err: Error) => this.core.log.warn({ err: err.message, ch }, 'ws unsubscribe failed'));
  }

  /**
   * Updates are queued per channel and fanned out in time slices. While the node keeps up, the queue holds
   * at most the current update and adds no latency; when it falls behind, a newer snapshot (order book,
   * ticker, mark) replaces the one still waiting and trade batches / ticker deltas merge, so a lagging
   * node sends fewer, fresher frames instead of building an unbounded backlog of stale ones. Private
   * user events and other event types are never dropped or reordered.
   */
  private enqueue(message: string): void {
    let env: WsEnvelope;
    try {
      env = JSON.parse(message) as WsEnvelope;
    } catch {
      return;
    }
    const queue = this.pending.get(env.channel);
    if (!queue) {
      this.pending.set(env.channel, [env]);
    } else {
      const last = queue[queue.length - 1]!;
      if (last.type === env.type && SNAPSHOT_TYPES.has(env.type)) {
        queue[queue.length - 1] = env;
        metrics.wsCoalesced.inc({ type: env.type });
      } else if (last.type === 'trades' && env.type === 'trades') {
        // Oldest first; the envelope keeps the earliest timestamp (lag is measured from the oldest trade).
        const trades = last.data as unknown[];
        trades.push(...(env.data as unknown[]));
        if (trades.length > MAX_MERGED_TRADES) trades.splice(0, trades.length - MAX_MERGED_TRADES);
        metrics.wsCoalesced.inc({ type: env.type });
      } else if (last.type === 'tickers' && env.type === 'tickers') {
        const bySymbol = new Map((last.data as TickerDto[]).map((t) => [t.symbol, t]));
        for (const t of env.data as TickerDto[]) bySymbol.set(t.symbol, t);
        last.data = [...bySymbol.values()];
        last.ts = env.ts;
        metrics.wsCoalesced.inc({ type: env.type });
      } else {
        queue.push(env);
      }
    }
    if (!this.draining) {
      this.draining = true;
      setImmediate(this.drain);
    }
  }

  private readonly drain = (): void => {
    const deadline = performance.now() + SLICE_MS;
    for (const [channel, queue] of this.pending) {
      this.pending.delete(channel);
      for (const env of queue) this.deliver(env);
      if (performance.now() >= deadline) break;
    }
    if (this.pending.size) setImmediate(this.drain);
    else this.draining = false;
  };

  private deliver(env: WsEnvelope): void {
    const members = this.io.sockets.adapter.rooms.get(env.channel);
    if (!members || members.size === 0) return;
    // The packet is encoded once and written to every member socket.
    this.io.local.to(env.channel).emit('event', env);
    metrics.wsMessages.inc({ scope: env.channel.startsWith('user:') ? 'user' : 'market' }, members.size);
  }

  /** Channels with updates waiting to be sent (exposed in /health). */
  get backlog(): number {
    return this.pending.size;
  }

  // ───────────────────────── auth ─────────────────────────

  private async authenticate(socket: Socket, token: string): Promise<void> {
    const claims = await this.core.auth.tokens.verifyAccess(token);
    const flags = await this.core.users.flags(claims.userId);
    if (flags.status === 'DISABLED') throw new Error('disabled');
    const d = socket.data as SocketData;
    if (d.userId && d.userId !== claims.userId) this.deauthenticate(socket);
    d.userId = claims.userId;
    d.sessionId = claims.sessionId;
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      exp?: number;
    };
    d.exp = (payload.exp ?? 0) * 1000;
    let sockets = this.socketsByUser.get(claims.userId);
    if (!sockets) {
      sockets = new Set();
      this.socketsByUser.set(claims.userId, sockets);
    }
    sockets.add(socket);
    for (const kind of USER_CHANNEL_KINDS) void socket.join(userChannel(claims.userId, kind));
  }

  private forget(socket: Socket, userId: string): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) this.socketsByUser.delete(userId);
  }

  private deauthenticate(socket: Socket): void {
    const d = socket.data as SocketData;
    if (!d.userId) return;
    for (const kind of USER_CHANNEL_KINDS) void socket.leave(userChannel(d.userId, kind));
    this.forget(socket, d.userId);
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

  private allowOp(d: SocketData): boolean {
    const now = Date.now();
    if (now - d.opsWindowStart >= 1000) {
      d.opsWindowStart = now;
      d.ops = 0;
    }
    return ++d.ops <= MAX_OPS_PER_SECOND;
  }

  private onConnection(socket: Socket): void {
    metrics.wsConnections.set(this.io.engine.clientsCount);
    const d = socket.data as SocketData;

    socket.on('subscribe', (msg: { channels?: unknown }, ack?: (r: WsSubscribeAck) => void) => {
      if (!this.allowOp(d)) return ack?.({ ok: [], denied: ['rate_limited'] });
      const channels = Array.isArray(msg?.channels)
        ? msg.channels.filter((c): c is string => typeof c === 'string').slice(0, 50)
        : [];
      const res: WsSubscribeAck = { ok: [], denied: [] };
      for (const c of channels) {
        if (d.subs.size >= MAX_SUBSCRIPTIONS || !this.validate(socket, c)) {
          res.denied.push(c);
          continue;
        }
        void socket.join(c);
        if (!d.subs.has(c)) {
          d.subs.add(c);
          metrics.wsSubscriptions.inc();
        }
        res.ok.push(c);
      }
      ack?.(res);
    });

    socket.on('unsubscribe', (msg: { channels?: unknown }, ack?: (r: WsSubscribeAck) => void) => {
      if (!this.allowOp(d)) return ack?.({ ok: [], denied: ['rate_limited'] });
      const channels = Array.isArray(msg?.channels)
        ? msg.channels.filter((c): c is string => typeof c === 'string')
        : [];
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
      if (d.userId) this.forget(socket, d.userId);
      metrics.wsSubscriptions.dec(d.subs.size);
      metrics.wsConnections.set(this.io.engine.clientsCount);
    });
  }

  get connections(): number {
    return this.io.engine.clientsCount;
  }

  /** Number of Redis channels this node is subscribed to (exposed in /health). */
  get redisSubscriptions(): number {
    return this.redisRefs.size;
  }

  async close(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep);
    if (this.loadTimer) clearInterval(this.loadTimer);
    this.loopDelay.disable();
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
    await this.fanout?.quit().catch(() => undefined);
  }
}
