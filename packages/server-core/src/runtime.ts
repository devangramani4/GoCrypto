import { hostname } from 'node:os';
import type { Core } from './core';
import { key } from './redis';

/** Publish a liveness heartbeat (read by the admin system-health page). */
export function startHeartbeat(core: Core, service: string, details: () => Record<string, unknown> = () => ({})): () => void {
  const instance = `${hostname()}:${process.pid}`;
  const beat = () => {
    const mem = process.memoryUsage();
    const payload = {
      service,
      instance,
      ts: Date.now(),
      uptimeSec: Math.round(process.uptime()),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      ...details(),
    };
    core.redis.main.set(key('hb', service, instance), JSON.stringify(payload), 'EX', 30).catch(() => undefined);
  };
  beat();
  const timer = setInterval(beat, 5000);
  timer.unref();
  return () => {
    clearInterval(timer);
    void core.redis.main.del(key('hb', service, instance)).catch(() => undefined);
  };
}

/**
 * Leader election for singleton services (matching engine, liquidation monitor, schedulers).
 * Resolves once leadership is acquired; calls `onLost` if the lease cannot be renewed.
 */
export async function acquireLeadership(core: Core, name: string, onLost: () => void, ttlMs = 15_000): Promise<() => Promise<void>> {
  const token = `${hostname()}:${process.pid}:${Date.now()}`;
  const k = key('leader', name);
  for (;;) {
    const ok = await core.redis.main.set(k, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') break;
    core.log.info({ name }, 'waiting for leadership');
    await new Promise((r) => setTimeout(r, ttlMs / 3));
  }
  core.log.info({ name }, 'leadership acquired');
  const renew = setInterval(async () => {
    try {
      const res = await core.redis.main.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`,
        1,
        k,
        token,
        String(ttlMs),
      );
      if (res !== 1) {
        clearInterval(renew);
        core.log.error({ name }, 'leadership lost');
        onLost();
      }
    } catch (e) {
      core.log.warn({ err: e, name }, 'leadership renewal failed');
    }
  }, ttlMs / 3);
  renew.unref();
  return async () => {
    clearInterval(renew);
    await core.redis.main
      .eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, 1, k, token)
      .catch(() => undefined);
  };
}

/** Install SIGINT/SIGTERM handlers that run `shutdown` once. */
export function onShutdown(core: Core, shutdown: () => Promise<void>): void {
  let done = false;
  const handler = async (signal: string) => {
    if (done) return;
    done = true;
    core.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    try {
      await shutdown();
    } catch (e) {
      core.log.error({ err: e }, 'shutdown error');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void handler('SIGINT'));
  process.on('SIGTERM', () => void handler('SIGTERM'));
}
