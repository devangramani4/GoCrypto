import { SingleFlightCache } from '@gocrypto/server-core';
import type { FastifyReply } from 'fastify';

/**
 * Micro-caches for hot public endpoints. Responses are cached already serialized, so thousands of
 * identical requests per second cost one Redis/DB read and one JSON.stringify per TTL window per
 * process, and concurrent misses share a single load (no thundering herd). The Cache-Control headers
 * let a CDN absorb the same traffic in front of the API.
 */
export const publicCaches = {
  markets: new SingleFlightCache<string>(200, 5_000),
  tickers: new SingleFlightCache<string>(20, 1_000),
  ticker: new SingleFlightCache<string>(5_000, 500),
  orderBook: new SingleFlightCache<string>(20_000, 250),
  trades: new SingleFlightCache<string>(5_000, 500),
  candles: new SingleFlightCache<string>(20_000, 1_000),
  optionsChain: new SingleFlightCache<string>(2_000, 1_000),
  assets: new SingleFlightCache<string>(10, 10_000),
};

export async function sendCachedJson(
  reply: FastifyReply,
  cache: SingleFlightCache<string>,
  key: string,
  cacheControl: string,
  load: () => Promise<unknown>,
): Promise<FastifyReply> {
  const body = await cache.get(key, async () => JSON.stringify(await load()));
  return reply.header('cache-control', cacheControl).type('application/json; charset=utf-8').send(body);
}
