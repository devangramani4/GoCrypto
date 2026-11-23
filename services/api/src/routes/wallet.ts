import type { AccountType, WalletOverviewDto } from '@gocrypto/shared-types';
import { ACCOUNT_TYPES } from '@gocrypto/shared-types';
import { D, ZERO } from '@gocrypto/trading-utils';
import { accountTransferSchema, addressBookSchema, assetSymbol, booleanQuery, depositAddressQuery, idString, internalTransferSchema, simulateDepositSchema, validateAddressSchema, walletHistoryQuery, withdrawalLimitsQuery, withdrawSchema } from '@gocrypto/validation';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps';
import { authenticated, requireSession, requireUser } from '../plugins/auth';
import { requestContext } from '../util/context';

const page = z.object({ cursor: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function walletRoutes(app: FastifyInstance, { core }: ApiDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/overview', { preHandler: authenticated, config: { apiKey: 'READ' } }, async (req): Promise<WalletOverviewDto> => {
    const { userId } = requireUser(req);
    const balances = await core.wallet.balances(userId, undefined, false);
    const accounts = {} as WalletOverviewDto['accounts'];
    let total = ZERO;
    for (const a of ACCOUNT_TYPES) {
      const list = balances.filter((b) => b.account === a);
      const sum = list.reduce((acc, b) => acc.plus(b.usdValue), ZERO);
      accounts[a] = { totalUsd: sum.toFixed(2), balances: list };
      total = total.plus(sum);
    }
    // Derivatives equity includes unrealised PnL.
    const fut = await core.futures.accountDto(userId);
    const opt = await core.options.accountDto(userId);
    const futAdj = D(fut.unrealizedPnl);
    const optAdj = D(opt.equity).minus(opt.walletBalance);
    accounts.FUTURES.totalUsd = D(accounts.FUTURES.totalUsd).plus(futAdj).toFixed(2);
    accounts.OPTIONS.totalUsd = D(accounts.OPTIONS.totalUsd).plus(optAdj).toFixed(2);
    return { totalUsd: total.plus(futAdj).plus(optAdj).toFixed(2), accounts };
  });

  r.get(
    '/balances',
    { schema: { querystring: z.object({ account: z.enum(ACCOUNT_TYPES).optional(), includeZero: booleanQuery.optional() }) }, preHandler: authenticated, config: { apiKey: 'READ' } },
    async (req) => core.wallet.balances(requireUser(req).userId, req.query.account as AccountType | undefined, req.query.includeZero ?? false),
  );

  r.get('/deposit-address', { schema: { querystring: depositAddressQuery }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    core.walletOps.depositAddress(requireUser(req).userId, req.query.asset, req.query.network),
  );

  r.get('/deposits', { schema: { querystring: page }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    core.walletOps.deposits(requireUser(req).userId, req.query.limit, req.query.cursor),
  );

  r.post('/deposits/simulate', { schema: { body: simulateDepositSchema }, preHandler: authenticated, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) =>
    reply.status(201).send(await core.walletOps.simulateDeposit(requireSession(req).userId, req.body)),
  );

  r.get('/withdrawals', { schema: { querystring: page }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    core.walletOps.withdrawals(requireUser(req).userId, req.query.limit, req.query.cursor),
  );

  r.get('/withdrawals/limits', { schema: { querystring: withdrawalLimitsQuery }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    core.walletOps.withdrawalLimits(requireUser(req).userId, req.query.asset, req.query.network),
  );

  r.post(
    '/withdrawals/email-code',
    {
      schema: { body: z.object({ asset: assetSymbol, amount: z.string().max(48), address: z.string().max(128) }) },
      preHandler: authenticated,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await core.walletOps.sendWithdrawalCode(requireSession(req).userId, req.body);
      return reply.status(202).send({ ok: true });
    },
  );

  r.post('/withdrawals', { schema: { body: withdrawSchema }, preHandler: authenticated, config: { apiKey: 'WITHDRAW', idempotent: true } }, async (req, reply) =>
    reply.status(201).send(await core.walletOps.requestWithdrawal(requireUser(req).userId, req.body, requestContext(req))),
  );

  r.delete('/withdrawals/:id', { schema: { params: z.object({ id: idString }) }, preHandler: authenticated }, async (req) =>
    core.walletOps.cancelWithdrawal(requireSession(req).userId, req.params.id),
  );

  r.post('/transfer', { schema: { body: accountTransferSchema }, preHandler: authenticated, config: { apiKey: 'TRADE', idempotent: true } }, async (req, reply) =>
    reply.status(201).send(await core.walletOps.accountTransfer(requireUser(req).userId, req.body)),
  );

  r.post('/internal-transfer', { schema: { body: internalTransferSchema }, preHandler: authenticated, config: { idempotent: true } }, async (req, reply) =>
    reply.status(201).send(await core.walletOps.internalTransfer(requireSession(req).userId, req.body, requestContext(req))),
  );

  r.get('/transfers', { schema: { querystring: page }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    core.walletOps.transfers(requireUser(req).userId, req.query.limit, req.query.cursor),
  );

  r.get('/history', { schema: { querystring: walletHistoryQuery }, preHandler: authenticated, config: { apiKey: 'READ' } }, async (req) =>
    core.wallet.ledger(requireUser(req).userId, req.query),
  );

  r.get('/address-book', { preHandler: authenticated }, async (req) => core.walletOps.addressBook(requireSession(req).userId));

  r.post('/address-book', { schema: { body: addressBookSchema }, preHandler: authenticated }, async (req, reply) =>
    reply.status(201).send(await core.walletOps.addAddress(requireSession(req).userId, req.body)),
  );

  r.delete('/address-book/:id', { schema: { params: z.object({ id: idString }) }, preHandler: authenticated }, async (req, reply) => {
    await core.walletOps.removeAddress(requireSession(req).userId, req.params.id);
    return reply.status(204).send();
  });

  r.post('/validate-address', { schema: { body: validateAddressSchema } }, async (req) =>
    core.walletOps.validateAddressFor(req.body.network, req.body.address, req.body.memo),
  );
}
