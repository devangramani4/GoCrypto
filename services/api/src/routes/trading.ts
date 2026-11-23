import { AppError } from '@gocrypto/server-core';
import type { MarketType } from '@gocrypto/shared-types';
import {
  adjustMarginSchema,
  amendOrderSchema,
  closePositionSchema,
  futuresOrderSchema,
  idString,
  leverageSchema,
  marginModeSchema,
  ocoOrderSchema,
  openOrdersQuery,
  optionsChainQuery,
  optionsOrderSchema,
  orderHistoryQuery,
  positionTpSlSchema,
  spotOrderSchema,
  symbolSchema,
  tradeHistoryQuery,
} from '@gocrypto/validation';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps';
import { authenticated, requireUser } from '../plugins/auth';
import { orderSource } from '../util/context';

const idParam = z.object({ id: idString });
const symbolParam = z.object({ symbol: symbolSchema });

function orderRateLimit(core: ApiDeps['core']) {
  return core.config.ORDER_RATE_LIMIT_PER_SEC;
}

/** Shared order queries for all market types. */
async function openOrders(deps: ApiDeps, userId: string, marketType?: MarketType, symbol?: string) {
  const marketId = symbol ? deps.core.markets.require(symbol).id : undefined;
  const rows = await deps.core.orders.openOrders(userId, { marketType, marketId });
  return rows.map((r) => deps.core.orders.toDto(r));
}

export async function spotRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { core, admission } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const trade = { apiKey: 'TRADE' as const, idempotent: true, userRateLimit: orderRateLimit(core) };

  r.post('/orders', { schema: { body: spotOrderSchema, tags: ['spot'] }, preHandler: authenticated, config: trade }, async (req, reply) => {
    const res = await admission.placeSpotOrder(requireUser(req).userId, req.body, { source: orderSource(req) });
    return reply.status(201).send(res);
  });

  r.post('/orders/oco', { schema: { body: ocoOrderSchema, tags: ['spot'] }, preHandler: authenticated, config: trade }, async (req, reply) => {
    return reply.status(201).send(await admission.placeOco(requireUser(req).userId, req.body, { source: orderSource(req) }));
  });

  r.patch('/orders/:id', { schema: { params: idParam, body: amendOrderSchema }, preHandler: authenticated, config: { apiKey: 'TRADE', userRateLimit: orderRateLimit(core) } }, async (req) => {
    const row = await admission.amendOrder(requireUser(req).userId, req.params.id, req.body);
    return core.orders.toDto(row);
  });

  r.delete('/orders/:id', { schema: { params: idParam }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) =>
    core.orders.toDto(await admission.cancelOrder(requireUser(req).userId, req.params.id)),
  );

  r.delete('/orders', { schema: { querystring: z.object({ symbol: symbolSchema.optional() }) }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) => ({
    cancelled: await admission.cancelAll(requireUser(req).userId, req.query.symbol, 'SPOT'),
  }));

  r.get('/orders/open', { schema: { querystring: z.object({ symbol: symbolSchema.optional() }) }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    openOrders(deps, requireUser(req).userId, 'SPOT', req.query.symbol),
  );
}

export async function orderRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { core, admission } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/', { schema: { querystring: orderHistoryQuery, tags: ['orders'] }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => {
    const q = req.query;
    const page = await core.orders.history(requireUser(req).userId, {
      ...q,
      marketId: q.symbol ? core.markets.require(q.symbol).id : undefined,
    });
    return { items: page.items.map((o) => core.orders.toDto(o)), nextCursor: page.nextCursor };
  });

  r.get('/open', { schema: { querystring: openOrdersQuery }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    openOrders(deps, requireUser(req).userId, req.query.marketType, req.query.symbol),
  );

  r.get('/:id', { schema: { params: idParam }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => {
    const { userId } = requireUser(req);
    const row = await core.orders.findForUser(userId, req.params.id);
    if (!row) throw new AppError('ORDER_NOT_FOUND', 'Order not found');
    const fills = await core.orders.fills(userId, { limit: 200, orderId: row.id });
    const history = await core.db.query<{ event: string; status_after: string; created_at: Date }>(
      'SELECT event, status_after, created_at FROM order_history WHERE order_id = ? ORDER BY id',
      [row.id],
    );
    return {
      order: core.orders.toDto(row),
      fills: fills.items,
      history: history.map((h) => ({ event: h.event, status: h.status_after, ts: h.created_at.getTime() })),
    };
  });

  r.delete('/:id', { schema: { params: idParam }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) =>
    core.orders.toDto(await admission.cancelOrder(requireUser(req).userId, req.params.id)),
  );

  r.delete('/', { schema: { querystring: z.object({ symbol: symbolSchema.optional() }) }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) => ({
    cancelled: await admission.cancelAll(requireUser(req).userId, req.query.symbol),
  }));
}

export async function tradeRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/', { schema: { querystring: tradeHistoryQuery, tags: ['trades'] }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => {
    const q = req.query;
    return core.orders.fills(requireUser(req).userId, { ...q, marketId: q.symbol ? core.markets.require(q.symbol).id : undefined });
  });
}

export async function futuresRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { core, admission } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const trade = { apiKey: 'TRADE' as const, idempotent: true, userRateLimit: orderRateLimit(core) };

  r.get('/contracts', { config: { apiKey: 'READ' } }, async () => core.markets.list('FUTURES').map((m) => core.markets.toDto(m)));

  r.get('/contracts/:symbol', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req) => {
    const m = core.futures.requireFutures(req.params.symbol);
    return { contract: core.markets.toDto(m), mark: await core.prices.markPrice(m.symbol), fundingHistory: await core.funding.history(m, 24) };
  });

  r.get('/account', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.futures.accountDto(requireUser(req).userId));
  r.get('/positions', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.futures.positionDtos(requireUser(req).userId));

  r.get('/settings/:symbol', { schema: { params: symbolParam }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => {
    const m = core.futures.requireFutures(req.params.symbol);
    const s = await core.futures.settings(requireUser(req).userId, m);
    return { symbol: m.symbol, leverage: s.leverage, marginMode: s.marginMode, maxLeverage: m.futures!.maxLeverage };
  });

  r.post('/leverage', { schema: { body: leverageSchema }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) =>
    admission.setLeverage(requireUser(req).userId, req.body.symbol, req.body.leverage),
  );

  r.post('/margin-mode', { schema: { body: marginModeSchema }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) =>
    admission.setMarginMode(requireUser(req).userId, req.body.symbol, req.body.marginMode),
  );

  r.post('/orders', { schema: { body: futuresOrderSchema, tags: ['futures'] }, preHandler: authenticated, config: trade }, async (req, reply) =>
    reply.status(201).send(await admission.placeFuturesOrder(requireUser(req).userId, req.body, { source: orderSource(req) })),
  );

  r.delete('/orders/:id', { schema: { params: idParam }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) =>
    core.orders.toDto(await admission.cancelOrder(requireUser(req).userId, req.params.id)),
  );

  r.get('/orders/open', { schema: { querystring: z.object({ symbol: symbolSchema.optional() }) }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    openOrders(deps, requireUser(req).userId, 'FUTURES', req.query.symbol),
  );

  r.post('/positions/:symbol/close', { schema: { params: symbolParam, body: closePositionSchema }, preHandler: authenticated, config: trade }, async (req) =>
    admission.closePosition(requireUser(req).userId, req.params.symbol, req.body.quantity, { source: orderSource(req) }),
  );

  r.post('/positions/:symbol/margin', { schema: { params: symbolParam, body: adjustMarginSchema }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) => {
    await admission.adjustIsolatedMargin(requireUser(req).userId, req.params.symbol, req.body.amount, req.body.direction);
    return (await core.futures.positionDtos(requireUser(req).userId)).find((p) => p.symbol === req.params.symbol) ?? null;
  });

  r.post('/positions/:symbol/tpsl', { schema: { params: symbolParam, body: positionTpSlSchema }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) =>
    admission.setPositionTpSl(requireUser(req).userId, req.params.symbol, req.body, { source: orderSource(req) }),
  );

  r.get('/funding-rates/:symbol', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req) =>
    core.funding.history(core.futures.requireFutures(req.params.symbol), 200),
  );

  r.get('/funding-history', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.futures.fundingHistory(requireUser(req).userId));
  r.get('/liquidations', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.futures.liquidationHistory(requireUser(req).userId));
}

export async function optionsRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { core, admission } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/underlyings', { config: { apiKey: 'READ' } }, async () => core.options.underlyings());
  r.get('/expiries', { schema: { querystring: z.object({ underlying: z.string().regex(/^[A-Z0-9]{2,10}$/) }) }, config: { apiKey: 'READ' } }, async (req) =>
    core.options.expiries(req.query.underlying),
  );
  r.get('/chain', { schema: { querystring: optionsChainQuery }, config: { apiKey: 'READ' } }, async (req, reply) => {
    void reply.header('cache-control', 'public, max-age=1');
    return core.options.chain(req.query.underlying, req.query.expiry);
  });

  r.get('/contracts/:symbol', { schema: { params: symbolParam }, config: { apiKey: 'READ' } }, async (req) => {
    const m = core.markets.require(req.params.symbol, 'OPTIONS');
    const chain = await core.options.chain(m.option!.underlying, m.option!.expiryAt);
    const row = chain.rows.find((x) => x.strike === m.option!.strike);
    return { contract: core.markets.toDto(m), quote: m.option!.optionType === 'CALL' ? row?.call : row?.put, indexPrice: chain.indexPrice };
  });

  r.post('/orders', { schema: { body: optionsOrderSchema, tags: ['options'] }, preHandler: authenticated, config: { apiKey: 'TRADE', idempotent: true, userRateLimit: orderRateLimit(core) } }, async (req, reply) =>
    reply.status(201).send(await admission.placeOptionsOrder(requireUser(req).userId, req.body, { source: orderSource(req) })),
  );

  r.delete('/orders/:id', { schema: { params: idParam }, preHandler: authenticated, config: { apiKey: 'TRADE' } }, async (req) =>
    core.orders.toDto(await admission.cancelOrder(requireUser(req).userId, req.params.id)),
  );

  r.get('/orders/open', { schema: { querystring: z.object({ symbol: symbolSchema.optional() }) }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    openOrders(deps, requireUser(req).userId, 'OPTIONS', req.query.symbol),
  );

  r.get('/positions', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.options.positionDtos(requireUser(req).userId));
  r.get('/account', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.options.accountDto(requireUser(req).userId));
  r.get('/settlements', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) => core.options.settlements(requireUser(req).userId));
}
