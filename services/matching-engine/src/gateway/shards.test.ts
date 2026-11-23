import { describe, expect, it } from 'vitest';
import { EngineShardMap } from './shards';

const markets = new Map<number, { symbol: string }>([
  [1, { symbol: 'BTCUSDT' }],
  [2, { symbol: 'ETHUSDT' }],
  [3, { symbol: 'SOLUSDT' }],
  [4, { symbol: 'BTCUSDT-PERP' }],
  [5, { symbol: 'ETHUSDT-PERP' }],
]);
const lookup = { byId: (id: number) => markets.get(id) };

describe('EngineShardMap', () => {
  it('keeps the legacy stream and a single shard by default', () => {
    const map = new EngineShardMap(lookup, 1, '');
    expect([1, 2, 3, 4, 5].map((id) => map.shardOf(id))).toEqual([0, 0, 0, 0, 0]);
    expect(map.stream(0)).toBe('stream:engine:commands');
  });

  it('spreads markets by id and gives every shard its own stream', () => {
    const map = new EngineShardMap(lookup, 3, '');
    expect([1, 2, 3, 4, 5].map((id) => map.shardOf(id))).toEqual([1, 2, 0, 1, 2]);
    expect(map.streamFor(4)).toBe('stream:engine:commands:1');
    // Unknown markets still route deterministically.
    expect(map.shardOf(99)).toBe(0);
  });

  it('honours pins so the busiest books can be isolated', () => {
    const map = new EngineShardMap(lookup, 4, ' btcusdt=0, BTCUSDT-PERP = 3 ');
    expect(map.shardOf(1)).toBe(0);
    expect(map.shardOf(4)).toBe(3);
    expect(map.shardOf(2)).toBe(2);
  });

  it('rejects pins that point outside the shard range', () => {
    expect(() => new EngineShardMap(lookup, 2, 'BTCUSDT=2')).toThrow(/ENGINE_SHARD_PINS/);
    expect(() => new EngineShardMap(lookup, 2, 'BTCUSDT')).toThrow(/ENGINE_SHARD_PINS/);
  });
});
