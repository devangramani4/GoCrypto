/**
 * Bounded in-process cache with per-entry TTL and LRU eviction.
 *
 * Every per-user cache must be bounded: an unbounded Map keyed by user id grows with the user base
 * (millions of entries per process) and is never reclaimed. Map iteration order is insertion order,
 * so re-inserting on read keeps the least recently used entry at the front.
 */
export class TtlCache<K, V> {
  private readonly map = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: K, value: V, ttlMs: number = this.ttlMs): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  /** Remove every entry whose key matches (e.g. all fee overrides of one user). */
  deleteWhere(predicate: (key: K) => boolean): void {
    for (const k of this.map.keys()) if (predicate(k)) this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Coalesces concurrent loads of the same key into one in-flight promise and caches the result for
 * `ttlMs` (thundering-herd protection for hot public endpoints).
 */
export class SingleFlightCache<V> {
  private readonly cache: TtlCache<string, V>;
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(maxEntries: number, ttlMs: number) {
    this.cache = new TtlCache<string, V>(maxEntries, ttlMs);
  }

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = load()
      .then((v) => {
        this.cache.set(key, v);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  invalidate(predicate?: (key: string) => boolean): void {
    if (predicate) this.cache.deleteWhere(predicate);
    else this.cache.clear();
  }
}
