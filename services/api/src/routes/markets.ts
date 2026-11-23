import { AppError, FundingService } from '@gocrypto/server-core';
import type { MarkPriceDto, OrderBookDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { candlesQuery, marketListQuery, orderBookQuery, publicTradesQuery, symbolSchema } from '@gocrypto/validation';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps';
import { publicCaches, sendCachedJson } from '../util/public-cache';

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

  r.get(
    '/',
    { schema: { querystring: marketListQuery, tags: ['markets'] }, config: { apiKey: 'READ' } },
    async (req, reply) =>
      sendCachedJson(
        reply,
        publicCaches.markets,
        `${req.query.type ?? '*'}|${req.query.underlying ?? '*'}`,
        'public, max-age=5',
        async () => {
          let list = core.markets.list(req.query.type).filter((m) => m.status !== 'DELISTED' && m.status !== 'SETTLED');
          if (req.query.underlying)
            list = list.filter(
              (m) => (m.futures?.underlying ?? m.option?.underlying ?? m.base) === req.query.underlying,
            );
          return list.map((m) => core.markets.toDto(m, core.fees.baseRates(m)));
        },
      ),
  );

  r.get(
    '/tickers',
    {
      schema: { querystring: z.object({ type: z.enum(['SPOT', 'FUTURES', 'OPTIONS']).optional() }) },
      config: { apiKey: 'READ' },
    },
    async (req, reply) =>
      sendCachedJson(reply, publicCaches.tickers, req.query.type ?? '*', cache.maxAge, () =>
        core.marketQueries.tickers(req.query.type ?? undefined),
      ),
  );

  r.get('/:symbol', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req) => {
    const m = core.markets.require(req.params.symbol);
    return core.markets.toDto(m, core.fees.baseRates(m));
  });

  r.get('/:symbol/ticker', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req, reply) => {
    const m = core.markets.require(req.params.symbol);
    return sendCachedJson(reply, publicCaches.ticker, m.symbol, cache.maxAge, async () => {
      const t = await core.prices.ticker(m.symbol);
      if (!t) throw new AppError('NOT_FOUND', 'No ticker yet for this market');
      return t;
    });
  });

  r.get(
    '/:symbol/orderbook',
    { schema: { params: symbolParam, querystring: orderBookQuery }, config: { apiKey: 'READ' } },
    async (req, reply) => {
      const m = core.markets.require(req.params.symbol);
      const { depth, step } = req.query;
      // 250 ms micro-cache: identical depth requests within the window share one snapshot read.
      return sendCachedJson(
        reply,
        publicCaches.orderBook,
        `${m.symbol}|${depth}|${step ?? ''}`,
        'public, max-age=0, must-revalidate',
        async () => {
          const book = (await core.prices.orderBook(m.symbol)) ?? {
            symbol: m.symbol,
            bids: [],
            asks: [],
            seq: 0,
            ts: Date.now(),
          };
          if (step && D(step).gt(m.tickSize)) return aggregate(book, step, depth);
          return { ...book, bids: book.bids.slice(0, depth), asks: book.asks.slice(0, depth) };
        },
      );
    },
  );

  r.get(
    '/:symbol/trades',
    { schema: { params: symbolParam, querystring: publicTradesQuery }, config: { apiKey: 'READ' } },
    async (req, reply) => {
      const m = core.markets.require(req.params.symbol);
      return sendCachedJson(reply, publicCaches.trades, `${m.symbol}|${req.query.limit}`, cache.maxAge, () =>
        core.prices.recentTrades(m.symbol, req.query.limit),
      );
    },
  );

  r.get(
    '/:symbol/candles',
    { schema: { params: symbolParam, querystring: candlesQuery }, config: { apiKey: 'READ' } },
    async (req, reply) => {
      const m = core.markets.require(req.params.symbol);
      const { interval, from, to, limit } = req.query;
      const load = () => core.marketQueries.candles(m, interval, { from, to, limit });
      // The common "latest N candles" chart load is shared across users; explicit ranges are not cached.
      if (from === undefined && to === undefined) {
        return sendCachedJson(
          reply,
          publicCaches.candles,
          `${m.symbol}|${interval}|${limit}`,
          'public, max-age=1',
          load,
        );
      }
      void reply.header('cache-control', 'public, max-age=2');
      return load();
    },
  );

  r.get(
    '/:symbol/mark',
    { schema: { params: symbolParam }, config: { apiKey: 'READ' } },
    async (req): Promise<MarkPriceDto> => {
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
    },
  );
}
