import type { AccountType, MarkPriceDto, WsEnvelope, WsEventType, WsPayloads } from '@gocrypto/shared-types';
import type { ChainableCommander, Redis } from 'ioredis';
import { key } from './redis';
import { getLogger } from './logger';

/** Internal (service-to-service) pub/sub topics and their payloads. */
export interface InternalEvents {
  /** Underlying index price (per base asset), published by market-data ~1/s. */
  'price.index': { asset: string; price: string; ts: number };
  /** Futures mark price, published by market-data ~1/s. */
  'price.mark': MarkPriceDto & { marketId: number };
  /** A user's futures/options position changed (risk engine reloads it). */
  'position.changed': { userId: string; marketId: number; marketType: 'FUTURES' | 'OPTIONS' };
  /** A user's balances changed for an account (risk engine reloads cross margin). */
  'account.changed': { userId: string; account: AccountType };
  /** A trigger (stop / take-profit) order was registered or removed. */
  'order.trigger': { action: 'added' | 'removed'; orderId: string; marketId: number };
  /** Cached configuration must be reloaded. */
  'config.changed': { scope: 'markets' | 'fees' | 'settings' | 'roles' | 'assets'; id?: string };
  /** Sessions were revoked; websocket gateway disconnects matching sockets. */
  'session.revoked': { userId: string; sessionIds: string[] | 'ALL' };
}
export type InternalTopic = keyof InternalEvents;

/** Durable Redis streams (consumer groups, at-least-once). */
export const STREAMS = {
  trades: 'stream:trades',
  engineCommands: 'stream:engine:commands',
} as const;

export interface TradeStreamEntry {
  marketId: number;
  symbol: string;
  marketType: 'SPOT' | 'FUTURES' | 'OPTIONS';
  seq: number;
  tradeId: string;
  price: string;
  qty: string;
  quoteQty: string;
  takerSide: 'BUY' | 'SELL';
  ts: number;
}

/**
 * Redis pub/sub channel that carries a WebSocket channel. Market streams map 1:1; all private streams of
 * one user share a single channel (gc:ws:u:{userId}) so a gateway node needs one subscription per
 * connected user, and nodes only receive traffic for rooms they actually host.
 */
export function wsRedisChannel(channel: string): string {
  if (channel.startsWith('user:')) {
    const end = channel.indexOf(':', 5);
    return key('ws', 'u', end === -1 ? channel.slice(5) : channel.slice(5, end));
  }
  return key('ws', channel);
}

export class EventBus {
  constructor(private readonly pub: Redis) {}

  /** Publish to a client-facing WebSocket channel (fanned out by the websocket service). */
  ws<T extends WsEventType>(channel: string, type: T, data: WsPayloads[T]): void {
    const envelope: WsEnvelope<T> = { channel, type, data, ts: Date.now() };
    this.pub.publish(wsRedisChannel(channel), JSON.stringify(envelope)).catch((err: Error) => {
      getLogger().warn({ err: err.message, channel }, 'ws publish failed');
    });
  }

  emit<T extends InternalTopic>(topic: T, payload: InternalEvents[T]): void {
    this.pub.publish(key('evt', topic), JSON.stringify(payload)).catch((err: Error) => {
      getLogger().warn({ err: err.message, topic }, 'event publish failed');
    });
  }

  async appendStream(stream: string, data: unknown, maxLen = 200_000): Promise<string | null> {
    return this.pub.xadd(key(stream), 'MAXLEN', '~', String(maxLen), '*', 'd', JSON.stringify(data));
  }

  /** Queue a stream append on a pipeline (same encoding as appendStream). */
  appendStreamTo(pipeline: ChainableCommander, stream: string, data: unknown, maxLen = 200_000): void {
    pipeline.xadd(key(stream), 'MAXLEN', '~', String(maxLen), '*', 'd', JSON.stringify(data));
  }
}

type Handler<T> = (payload: T) => void | Promise<void>;

/** Subscribes to internal topics on a dedicated subscriber connection. */
export class EventSubscriber {
  private readonly handlers = new Map<string, Handler<unknown>[]>();
  private started = false;

  constructor(private readonly sub: Redis) {}

  on<T extends InternalTopic>(topic: T, handler: Handler<InternalEvents[T]>): this {
    const channel = key('evt', topic);
    const list = this.handlers.get(channel) ?? [];
    list.push(handler as Handler<unknown>);
    this.handlers.set(channel, list);
    if (this.started) void this.sub.subscribe(channel);
    return this;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.sub.on('message', (channel: string, message: string) => {
      const list = this.handlers.get(channel);
      if (!list) return;
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }
      for (const h of list) {
        Promise.resolve(h(payload)).catch((err) => getLogger().error({ err, channel }, 'event handler failed'));
      }
    });
    const channels = [...this.handlers.keys()];
    if (channels.length) await this.sub.subscribe(...channels);
  }
}

export interface StreamMessage<T> {
  id: string;
  data: T;
}

/**
 * At-least-once consumer for a Redis stream using consumer groups. Pending (un-acked) entries are
 * re-delivered on restart, so handlers must be idempotent.
 */
export class StreamConsumer<T> {
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly stream: string,
    private readonly group: string,
    private readonly consumer: string,
    private readonly handler: (messages: StreamMessage<T>[]) => Promise<void>,
    private readonly opts: { batch?: number; blockMs?: number; startId?: '$' | '0' } = {},
  ) {}

  async start(): Promise<void> {
    const streamKey = key(this.stream);
    try {
      await this.redis.xgroup('CREATE', streamKey, this.group, this.opts.startId ?? '$', 'MKSTREAM');
    } catch (e) {
      if (!String((e as Error).message).includes('BUSYGROUP')) throw e;
    }
    this.running = true;
    this.loop = this.run(streamKey);
  }

  private parse(entries: [string, string[]][]): StreamMessage<T>[] {
    const out: StreamMessage<T>[] = [];
    for (const [id, fields] of entries) {
      const idx = fields.indexOf('d');
      if (idx === -1) continue;
      try {
        out.push({ id, data: JSON.parse(fields[idx + 1]!) as T });
      } catch {
        out.push({ id, data: null as T });
      }
    }
    return out;
  }

  private async run(streamKey: string): Promise<void> {
    let cursor = '0'; // first drain our own pending entries, then switch to new ones
    while (this.running) {
      try {
        const res = (await this.redis.xreadgroup(
          'GROUP',
          this.group,
          this.consumer,
          'COUNT',
          String(this.opts.batch ?? 200),
          'BLOCK',
          String(this.opts.blockMs ?? 2000),
          'STREAMS',
          streamKey,
          cursor,
        )) as [string, [string, string[]][]][] | null;
        const entries = res?.[0]?.[1] ?? [];
        if (cursor === '0' && entries.length === 0) {
          cursor = '>';
          continue;
        }
        if (entries.length === 0) continue;
        const messages = this.parse(entries);
        await this.handler(messages.filter((m) => m.data !== null));
        await this.redis.xack(streamKey, this.group, ...entries.map(([id]) => id));
      } catch (e) {
        if (!this.running) break;
        getLogger().error({ err: e, stream: this.stream, group: this.group }, 'stream consumer error');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.redis.disconnect();
    await this.loop?.catch(() => undefined);
  }
}

/**
 * Pipelined consumer: keeps reading while earlier messages are still being processed, up to
 * `maxInFlight`, and acknowledges each message as it completes. Handlers are invoked strictly in
 * stream order, so a handler that enqueues work synchronously (the matching engine's per-market
 * chains) preserves per-key ordering while independent keys proceed in parallel — a slow hot market
 * no longer stalls every other market behind a batch barrier.
 */
export class PipelinedStreamConsumer<T> {
  private running = false;
  private loop: Promise<void> | null = null;
  private inFlight = 0;
  private slotWaiters: (() => void)[] = [];
  private ackIds: string[] = [];
  private ackScheduled = false;
  private streamKey = '';

  constructor(
    private readonly redis: Redis,
    private readonly stream: string,
    private readonly group: string,
    private readonly consumer: string,
    private readonly handler: (message: StreamMessage<T>) => Promise<void>,
    private readonly opts: { batch?: number; blockMs?: number; maxInFlight?: number; startId?: '$' | '0' } = {},
  ) {}

  async start(): Promise<void> {
    this.streamKey = key(this.stream);
    try {
      await this.redis.xgroup('CREATE', this.streamKey, this.group, this.opts.startId ?? '$', 'MKSTREAM');
    } catch (e) {
      if (!String((e as Error).message).includes('BUSYGROUP')) throw e;
    }
    this.running = true;
    this.loop = this.run();
  }

  get pending(): number {
    return this.inFlight;
  }

  private waitForSlot(): Promise<void> {
    return new Promise((resolve) => this.slotWaiters.push(resolve));
  }

  private scheduleAck(id: string): void {
    this.ackIds.push(id);
    if (this.ackScheduled) return;
    this.ackScheduled = true;
    setImmediate(() => {
      const ids = this.ackIds;
      this.ackIds = [];
      this.ackScheduled = false;
      if (ids.length) {
        this.redis
          .xack(this.streamKey, this.group, ...ids)
          .catch((err: Error) => getLogger().warn({ err: err.message, stream: this.stream }, 'xack failed'));
      }
    });
  }

  private dispatch(entries: [string, string[]][]): void {
    for (const [id, fields] of entries) {
      const idx = fields.indexOf('d');
      let data: T | null;
      try {
        data = idx === -1 ? null : (JSON.parse(fields[idx + 1]!) as T);
      } catch {
        data = null; // unparseable entries are acknowledged and skipped
      }
      if (data === null) {
        this.scheduleAck(id);
        continue;
      }
      this.inFlight += 1;
      this.handler({ id, data })
        .catch((err: unknown) => getLogger().error({ err, stream: this.stream, id }, 'stream message failed'))
        .finally(() => {
          this.inFlight -= 1;
          this.scheduleAck(id);
          this.slotWaiters.shift()?.();
        });
    }
  }

  private async run(): Promise<void> {
    const max = this.opts.maxInFlight ?? 1000;
    let cursor = '0'; // first re-deliver our own pending entries (crash recovery), then new ones
    while (this.running) {
      try {
        if (this.inFlight >= max) {
          await this.waitForSlot();
          continue;
        }
        const res = (await this.redis.xreadgroup(
          'GROUP',
          this.group,
          this.consumer,
          'COUNT',
          String(Math.max(1, Math.min(this.opts.batch ?? 200, max - this.inFlight))),
          'BLOCK',
          String(this.opts.blockMs ?? 2000),
          'STREAMS',
          this.streamKey,
          cursor,
        )) as [string, [string, string[]][]][] | null;
        const entries = res?.[0]?.[1] ?? [];
        if (cursor === '0' && entries.length === 0) {
          cursor = '>';
          continue;
        }
        if (entries.length) this.dispatch(entries);
      } catch (e) {
        if (!this.running) break;
        getLogger().error({ err: e, stream: this.stream, group: this.group }, 'stream consumer error');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  /** Stop reading, then wait for in-flight messages to finish and their acks to flush. */
  async stop(): Promise<void> {
    this.running = false;
    while (this.inFlight > 0) await new Promise((r) => setTimeout(r, 20));
    if (this.ackIds.length) await this.redis.xack(this.streamKey, this.group, ...this.ackIds).catch(() => undefined);
    this.ackIds = [];
    this.redis.disconnect();
    await this.loop?.catch(() => undefined);
  }
}
