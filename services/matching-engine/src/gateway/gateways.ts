import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  type Core,
  type EngineCommand,
  type EngineGateway,
  type EngineResult,
  STREAMS,
  StreamConsumer,
  type SubmitOptions,
  key,
} from '@gocrypto/server-core';
import type { EngineRunner } from '../runner/engine-runner';

interface CommandEnvelope {
  cmd: EngineCommand;
  requestId: string;
  replyTo: string | null;
  ts: number;
}

/** Engine hosted in the same process (development, tests, single-node deployments). */
export class InProcessEngineGateway implements EngineGateway {
  constructor(private readonly runner: EngineRunner) {}

  async submit(cmd: EngineCommand, opts: SubmitOptions = {}): Promise<EngineResult | null> {
    const p = this.runner.submit(cmd);
    if (opts.awaitResult === false) {
      p.catch(() => undefined);
      return null;
    }
    return p;
  }

  async close(): Promise<void> {
    await this.runner.idle();
  }
}

/**
 * Producer side for a standalone engine: commands go to a durable Redis stream; results come back
 * on a per-node pub/sub channel. A timeout returns null (the order is still processed and the
 * client is informed through WebSocket order updates).
 */
export class RedisEngineGateway implements EngineGateway {
  private readonly replyChannel = key('engine', 'reply', randomUUID());
  private readonly waiters = new Map<string, { resolve: (r: EngineResult | null) => void; timer: NodeJS.Timeout }>();
  private started = false;

  constructor(private readonly core: Core) {}

  async start(): Promise<this> {
    if (this.started) return this;
    this.started = true;
    const sub = this.core.redis.sub;
    sub.on('message', (channel: string, message: string) => {
      if (channel !== this.replyChannel) return;
      try {
        const { requestId, result } = JSON.parse(message) as { requestId: string; result: EngineResult };
        const w = this.waiters.get(requestId);
        if (!w) return;
        clearTimeout(w.timer);
        this.waiters.delete(requestId);
        w.resolve(result);
      } catch {
        // ignore malformed replies
      }
    });
    await sub.subscribe(this.replyChannel);
    return this;
  }

  async submit(cmd: EngineCommand, opts: SubmitOptions = {}): Promise<EngineResult | null> {
    if (!this.started) await this.start();
    const requestId = randomUUID();
    const wait = opts.awaitResult !== false;
    const envelope: CommandEnvelope = { cmd, requestId, replyTo: wait ? this.replyChannel : null, ts: Date.now() };
    if (!wait) {
      await this.core.bus.appendStream(STREAMS.engineCommands, envelope, 1_000_000);
      return null;
    }
    const result = new Promise<EngineResult | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        resolve(null);
      }, opts.timeoutMs ?? this.core.config.ENGINE_REPLY_TIMEOUT_MS);
      this.waiters.set(requestId, { resolve, timer });
    });
    await this.core.bus.appendStream(STREAMS.engineCommands, envelope, 1_000_000);
    return result;
  }

  async close(): Promise<void> {
    for (const w of this.waiters.values()) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    this.waiters.clear();
    await this.core.redis.sub.unsubscribe(this.replyChannel).catch(() => undefined);
  }
}

/** Engine side: consumes the command stream and replies to producers. */
export class EngineCommandConsumer {
  private consumer: StreamConsumer<CommandEnvelope> | null = null;

  constructor(
    private readonly core: Core,
    private readonly runner: EngineRunner,
  ) {}

  async start(): Promise<void> {
    this.consumer = new StreamConsumer<CommandEnvelope>(
      this.core.redis.blocking('engine-commands'),
      STREAMS.engineCommands,
      'matching-engine',
      `${hostname()}-${process.pid}`,
      async (messages) => {
        await Promise.all(
          messages.map(async (m) => {
            const result = await this.runner.submit(m.data.cmd);
            if (m.data.replyTo) {
              await this.core.redis.pub.publish(m.data.replyTo, JSON.stringify({ requestId: m.data.requestId, result }));
            }
          }),
        );
      },
      { batch: 500, blockMs: 1000 },
    );
    await this.consumer.start();
  }

  async stop(): Promise<void> {
    await this.consumer?.stop();
  }
}
