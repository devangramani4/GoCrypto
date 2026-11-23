import { AppError, FundingService } from '@gocrypto/server-core';
import type { MarkPriceDto, OrderBookDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { candlesQuery, marketListQuery, orderBookQuery, publicTradesQuery, symbolSchema } from '@gocrypto/validation';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps';

const symbolParam = z.object({ symbol: symbolSchema });

/** Aggregate a depth snapshot into price buckets of `step`. */
function aggregate(book: OrderBookDto, step: string, depth: number): OrderBookDto {
  const g = D(step);
  const group = (levels: [string, string][], side: 'bid' | 'ask') => {
    const out = new Map<string, ReturnType<typeof D>>();
    for (const [p, q] of levels) {
      const bucket = side === 'bid' ? D(p).div(g).floor().mul(g) : D(p).div(g).ceil().mul(g);
      const k = bucket.toFixed();
      out.set(k, (out.get(k) ?? D(0)).plus(q));
    }
    return [...out.entries()].slice(0, depth).map(([p, q]) => [p, q.toFixed()] as [string, string]);
  };
  return { ...book, bids: group(book.bids, 'bid'), asks: group(book.asks, 'ask') };
}

export async function marketRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const cache = { maxAge: 'public, max-age=1' };

  r.get('/', { schema: { querystring: marketListQuery, tags: ['markets'] }, config: { apiKey: 'READ' } }, async (req, reply) => {
    void reply.header('cache-control', 'public, max-age=5');
    let list = core.markets.list(req.query.type).filter((m) => m.status !== 'DELISTED' && m.status !== 'SETTLED');
    if (req.query.underlying) list = list.filter((m) => (m.futures?.underlying ?? m.option?.underlying ?? m.base) === req.query.underlying);
    return list.map((m) => core.markets.toDto(m, core.fees.baseRates(m)));
  });

  r.get('/tickers', { schema: { querystring: z.object({ type: z.enum(['SPOT', 'FUTURES', 'OPTIONS']).optional() }) }, config: { apiKey: 'READ' } }, async (req, reply) => {
    void reply.header('cache-control', cache.maxAge);
    return core.marketQueries.tickers(req.query.type ?? undefined);
  });

  r.get('/:symbol', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req) => {
    const m = core.markets.require(req.params.symbol);
    return core.markets.toDto(m, core.fees.baseRates(m));
  });

  r.get('/:symbol/ticker', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req) => {
    const m = core.markets.require(req.params.symbol);
    const t = await core.prices.ticker(m.symbol);
    if (!t) throw new AppError('NOT_FOUND', 'No ticker yet for this market');
    return t;
  });

  r.get('/:symbol/orderbook', { schema: { params: symbolParam, querystring: orderBookQuery }, config: { apiKey: 'READ' } }, async (req, reply) => {
    const m = core.markets.require(req.params.symbol);
    void reply.header('cache-control', 'no-store');
    const book = (await core.prices.orderBook(m.symbol)) ?? { symbol: m.symbol, bids: [], asks: [], seq: 0, ts: Date.now() };
    if (req.query.step && D(req.query.step).gt(m.tickSize)) return aggregate(book, req.query.step, req.query.depth);
    return { ...book, bids: book.bids.slice(0, req.query.depth), asks: book.asks.slice(0, req.query.depth) };
  });

  r.get('/:symbol/trades', { schema: { params: symbolParam, querystring: publicTradesQuery }, config: { apiKey: 'READ' } }, async (req) => {
    const m = core.markets.require(req.params.symbol);
    return core.prices.recentTrades(m.symbol, req.query.limit);
  });

  r.get('/:symbol/candles', { schema: { params: symbolParam, querystring: candlesQuery }, config: { apiKey: 'READ' } }, async (req, reply) => {
    const m = core.markets.require(req.params.symbol);
    void reply.header('cache-control', 'public, max-age=2');
    return core.marketQueries.candles(m, req.query.interval, { from: req.query.from, to: req.query.to, limit: req.query.limit });
  });

  r.get('/:symbol/mark', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req): Promise<MarkPriceDto> => {
    const m = core.futures.requireFutures(req.params.symbol);
    const mp = await core.prices.markPrice(m.symbol);
    if (mp) return mp;
    const last = (await core.prices.lastPrice(m.symbol)) ?? '0';
    return {
      symbol: m.symbol,
      markPrice: last,
      indexPrice: (await core.prices.indexPrice(m.futures!.underlying)) ?? last,
      fundingRate: m.futures!.interestRate,
      nextFundingTime: FundingService.nextFundingTime(m.futures!.fundingIntervalHours),
      ts: Date.now(),
    };
  });
}
