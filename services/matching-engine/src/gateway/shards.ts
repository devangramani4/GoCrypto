import { type Core, STREAMS } from '@gocrypto/server-core';

/**
 * Market → matching-engine shard placement.
 *
 * Every market is owned by exactly one shard, which is the single writer of its order book; shards run
 * as separate processes (separate event loops and database pools), so adding shards scales matching
 * horizontally across markets. Producers route each command to its market's shard stream, so all
 * producers and engines must be configured with the same ENGINE_SHARDS and ENGINE_SHARD_PINS.
 *
 * Placement is `market id mod shards` unless a symbol is pinned (isolate the busiest books on their own
 * shards with ENGINE_SHARD_PINS="BTCUSDT=0,ETHUSDT=1"). With one shard the stream name is unchanged.
 */
export class EngineShardMap {
  readonly count: number;
  private readonly pins = new Map<string, number>();

  constructor(
    private readonly lookup: { byId(id: number): { symbol: string } | undefined },
    count: number,
    pins: string,
  ) {
    this.count = count;
    for (const part of pins
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const [symbol, shard] = part.split('=').map((s) => s.trim());
      const n = Number(shard);
      if (!symbol || !Number.isInteger(n) || n < 0 || n >= count) {
        throw new Error(`Invalid ENGINE_SHARD_PINS entry "${part}" (expected SYMBOL=shard with shard < ${count})`);
      }
      this.pins.set(symbol.toUpperCase(), n);
    }
  }

  static fromConfig(core: Core): EngineShardMap {
    return new EngineShardMap(core.markets, core.config.ENGINE_SHARDS, core.config.ENGINE_SHARD_PINS);
  }

  shardOf(marketId: number): number {
    if (this.count === 1) return 0;
    const symbol = this.lookup.byId(marketId)?.symbol;
    const pinned = symbol === undefined ? undefined : this.pins.get(symbol);
    return pinned ?? marketId % this.count;
  }

  /** Command stream of a shard (the single-shard name is kept for compatibility). */
  stream(shard: number): string {
    return this.count === 1 ? STREAMS.engineCommands : `${STREAMS.engineCommands}:${shard}`;
  }

  streamFor(marketId: number): string {
    return this.stream(this.shardOf(marketId));
  }
}
