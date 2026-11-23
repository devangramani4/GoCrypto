import { Redis, type RedisOptions } from 'ioredis';
import { loadConfig } from './config';
import { getLogger } from './logger';

export { Redis } from 'ioredis';

export function createRedis(name: string, url = loadConfig().REDIS_URL, extra: RedisOptions = {}): Redis {
  const client = new Redis(url, {
    connectionName: `gocrypto:${name}`,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    ...extra,
  });
  client.on('error', (err) => getLogger().warn({ err: err.message, client: name }, 'redis error'));
  return client;
}

/** Namespaced Redis key helper: key('ticker', 'BTCUSDT') -> "gc:ticker:BTCUSDT". */
export function key(...parts: (string | number)[]): string {
  return `${loadConfig().REDIS_KEY_PREFIX}${parts.join(':')}`;
}

/** Redis connections used by a service: commands, publisher and a dedicated subscriber. */
export class RedisClients {
  readonly main: Redis;
  readonly pub: Redis;
  private subClient: Redis | null = null;

  constructor(readonly serviceName: string, readonly url = loadConfig().REDIS_URL) {
    this.main = createRedis(`${serviceName}:main`, url);
    this.pub = createRedis(`${serviceName}:pub`, url);
  }

  /** Lazily created subscriber connection (a connection in subscribe mode cannot run commands). */
  get sub(): Redis {
    if (!this.subClient) this.subClient = createRedis(`${this.serviceName}:sub`, this.url, { maxRetriesPerRequest: null });
    return this.subClient;
  }

  /** A fresh blocking connection (for XREADGROUP BLOCK loops). */
  blocking(name: string): Redis {
    return createRedis(`${this.serviceName}:${name}`, this.url, { maxRetriesPerRequest: null });
  }

  async ping(): Promise<number> {
    const t = performance.now();
    await this.main.ping();
    return Math.round((performance.now() - t) * 100) / 100;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.main.quit(), this.pub.quit(), this.subClient?.quit()]);
  }
}

/** Distributed lock (SET NX PX + compare-and-delete release). */
export class RedisLock {
  private static readonly RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

  constructor(private readonly redis: Redis) {}

  async acquire(name: string, ttlMs: number): Promise<string | null> {
    const token = `${process.pid}:${Math.random().toString(36).slice(2)}:${Date.now()}`;
    const ok = await this.redis.set(key('lock', name), token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
  }

  async release(name: string, token: string): Promise<boolean> {
    const res = await this.redis.eval(RedisLock.RELEASE, 1, key('lock', name), token);
    return res === 1;
  }

  /** Run fn while holding the lock; returns null (without running fn) if the lock is held elsewhere. */
  async withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = await this.acquire(name, ttlMs);
    if (!token) return null;
    try {
      return await fn();
    } finally {
      await this.release(name, token).catch(() => undefined);
    }
  }
}
