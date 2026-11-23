import type { Permission, UserRole } from '@gocrypto/shared-types';
import { ADMIN_ROLES } from '@gocrypto/shared-types';
import { AppError } from '@gocrypto/server-core';
import {
  adminAdjustBalanceSchema,
  adminAssetNetworkSchema,
  adminCreateFuturesMarketSchema,
  adminCreateSpotMarketSchema,
  adminFeeScheduleSchema,
  adminListQuery,
  adminOrdersQuery,
  adminReasonSchema,
  adminReportQuery,
  adminResetSecuritySchema,
  adminReviewWithdrawalSchema,
  adminRiskTiersSchema,
  adminRolePermissionsSchema,
  adminSettingsSchema,
  adminUpdateMarketSchema,
  adminUpdateUserSchema,
  adminUserFeeSchema,
  adminUserListQuery,
  adminWithdrawalQuery,
  idString,
  marketTypeSchema,
  pageQuery,
} from '@gocrypto/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps';
import { permissionGuard, requireSession } from '../plugins/auth';

const idParam = z.object({ id: idString });

export async function adminRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { core, admission } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const can = (p: Permission) => ({ preHandler: permissionGuard(core, p), config: { apiKey: false as const } });
  const audit = async (req: FastifyRequest, action: string, targetType: string | null, targetId: string | null, metadata?: Record<string, unknown>) =>
    core.audit.log({ actorUserId: requireSession(req).userId, actorType: 'ADMIN', action, targetType, targetId, ip: req.ip, userAgent: req.headers['user-agent'], metadata });

  // ── profile / dashboard ──
  r.get('/me', { config: { apiKey: false } }, async (req) => {
    const a = requireSession(req);
    if (!ADMIN_ROLES.includes(a.role)) throw new AppError('FORBIDDEN', 'Admin access required');
    const u = await core.users.findById(a.userId);
    return { userId: a.userId, email: u?.email ?? null, displayName: u?.display_name ?? null, role: a.role, permissions: core.users.permissionsFor(a.role) };
  });
  r.get('/dashboard', can('dashboard.read'), async () => core.admin.dashboard());

  // ── users ──
  r.get('/users', { schema: { querystring: adminUserListQuery }, ...can('users.read') }, async (req) => core.admin.users(req.query));
  r.get('/users/:id', { schema: { params: idParam }, ...can('users.read') }, async (req) => core.admin.userDetail(req.params.id));
  r.patch('/users/:id', { schema: { params: idParam, body: adminUpdateUserSchema }, ...can('users.write') }, async (req) => {
    if (req.body.role) {
      if (!core.users.hasPermission(requireSession(req).role, 'users.roles')) throw new AppError('FORBIDDEN', 'Missing permission: users.roles');
      if (req.body.role === 'SUPER_ADMIN' && requireSession(req).role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only SUPER_ADMIN can grant SUPER_ADMIN');
    }
    await core.admin.updateUser(req.params.id, req.body);
    await audit(req, 'admin.user.update', 'USER', req.params.id, req.body);
    return core.admin.userDetail(req.params.id);
  });
  r.post('/users/:id/freeze', { schema: { params: idParam, body: adminReasonSchema }, ...can('users.freeze') }, async (req) => {
    await core.admin.setStatus(req.params.id, 'FROZEN', req.body.reason);
    await audit(req, 'admin.user.freeze', 'USER', req.params.id, req.body);
    return { ok: true };
  });
  r.post('/users/:id/unfreeze', { schema: { params: idParam, body: adminReasonSchema }, ...can('users.freeze') }, async (req) => {
    await core.admin.setStatus(req.params.id, 'ACTIVE', req.body.reason);
    await audit(req, 'admin.user.unfreeze', 'USER', req.params.id, req.body);
    return { ok: true };
  });
  r.post('/users/:id/disable', { schema: { params: idParam, body: adminReasonSchema }, ...can('users.freeze') }, async (req) => {
    await core.admin.setStatus(req.params.id, 'DISABLED', req.body.reason);
    await audit(req, 'admin.user.disable', 'USER', req.params.id, req.body);
    return { ok: true };
  });
  r.post('/users/:id/trading', { schema: { params: idParam, body: z.object({ enabled: z.boolean(), reason: z.string().min(3).max(500) }) }, ...can('users.trading') }, async (req) => {
    await core.admin.setTrading(req.params.id, req.body.enabled);
    if (!req.body.enabled) await admission.cancelAll(req.params.id).catch(() => undefined);
    await audit(req, req.body.enabled ? 'admin.user.enable_trading' : 'admin.user.disable_trading', 'USER', req.params.id, req.body);
    return { ok: true };
  });
  r.post('/users/:id/reset-security', { schema: { params: idParam, body: adminResetSecuritySchema }, ...can('users.security') }, async (req) => {
    await core.auth.adminResetSecurity(requireSession(req).userId, req.params.id, req.body);
    return { ok: true };
  });
  r.post('/users/:id/revoke-sessions', { schema: { params: idParam }, ...can('users.security') }, async (req) => {
    const n = await core.auth.revokeSessions(req.params.id, 'ALL', 'ADMIN_REVOKED');
    await audit(req, 'admin.user.revoke_sessions', 'USER', req.params.id);
    return { revoked: n };
  });
  r.get(
    '/users/:id/login-history',
    { schema: { params: idParam, querystring: z.object({ cursor: z.string().regex(/^\d{1,20}$/).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) }, ...can('users.read') },
    async (req) => core.auth.loginHistory(req.params.id, req.query.limit, req.query.cursor),
  );
  r.get('/users/:id/orders', { schema: { params: idParam, querystring: adminOrdersQuery }, ...can('orders.read') }, async (req) =>
    core.admin.orders({ ...req.query, userId: req.params.id }),
  );
  r.get('/users/:id/ledger', { schema: { params: idParam, querystring: z.object({ cursor: z.string().optional(), limit: z.coerce.number().default(100) }) }, ...can('wallet.read') }, async (req) =>
    core.wallet.ledger(req.params.id, { limit: Math.min(req.query.limit, 200), cursor: req.query.cursor }),
  );
  r.get('/users/:id/fees', { schema: { params: idParam }, ...can('fees.read') }, async (req) => core.admin.userFees(req.params.id));
  r.put('/users/:id/fees', { schema: { params: idParam, body: adminUserFeeSchema }, ...can('fees.write') }, async (req) => {
    await core.admin.setUserFee(req.params.id, req.body, requireSession(req).userId);
    await audit(req, 'admin.fees.user_override', 'USER', req.params.id, req.body);
    return core.admin.userFees(req.params.id);
  });
  r.delete('/users/:id/fees/:marketType', { schema: { params: z.object({ id: idString, marketType: marketTypeSchema }) }, ...can('fees.write') }, async (req) => {
    await core.admin.deleteUserFee(req.params.id, req.params.marketType);
    await audit(req, 'admin.fees.user_override_removed', 'USER', req.params.id, { marketType: req.params.marketType });
    return { ok: true };
  });
  r.post('/users/:id/adjust-balance', { schema: { params: idParam, body: adminAdjustBalanceSchema }, ...can('wallet.adjust') }, async (req) => {
    await core.admin.adjustBalance(requireSession(req).userId, req.params.id, req.body);
    await audit(req, 'admin.wallet.adjust', 'USER', req.params.id, req.body);
    return { ok: true };
  });

  // ── markets ──
  r.get('/markets', { schema: { querystring: z.object({ type: marketTypeSchema.optional() }) }, ...can('markets.read') }, async (req) =>
    core.markets.list(req.query.type).filter((m) => m.type !== 'OPTIONS' || req.query.type === 'OPTIONS').map((m) => core.markets.toDto(m)),
  );
  r.post('/markets/spot', { schema: { body: adminCreateSpotMarketSchema }, ...can('markets.write') }, async (req, reply) => {
    const symbol = await core.admin.createSpotMarket(req.body);
    await audit(req, 'admin.market.create_spot', 'MARKET', symbol, req.body);
    return reply.status(201).send(core.markets.toDto(core.markets.require(symbol)));
  });
  r.post('/markets/futures', { schema: { body: adminCreateFuturesMarketSchema }, ...can('markets.write') }, async (req, reply) => {
    const symbol = await core.admin.createFuturesMarket(req.body);
    await audit(req, 'admin.market.create_futures', 'MARKET', symbol, req.body);
    return reply.status(201).send(core.markets.toDto(core.markets.require(symbol)));
  });
  r.patch('/markets/:id', { schema: { params: z.object({ id: z.coerce.number().int() }), body: adminUpdateMarketSchema }, ...can('markets.write') }, async (req) => {
    if ((req.body.maxLeverage || req.body.defaultLeverage) && !core.users.hasPermission(requireSession(req).role, 'risk.write')) {
      throw new AppError('FORBIDDEN', 'Missing permission: risk.write');
    }
    await core.admin.updateMarket(req.params.id, req.body);
    await audit(req, 'admin.market.update', 'MARKET', String(req.params.id), req.body);
    return core.markets.toDto(core.markets.requireId(req.params.id));
  });
  r.put('/markets/:id/risk-tiers', { schema: { params: z.object({ id: z.coerce.number().int() }), body: adminRiskTiersSchema }, ...can('risk.write') }, async (req) => {
    await core.admin.setRiskTiers(req.params.id, req.body.tiers);
    await audit(req, 'admin.market.risk_tiers', 'MARKET', String(req.params.id), req.body);
    return core.markets.toDto(core.markets.requireId(req.params.id));
  });
  r.post('/markets/:id/reload', { schema: { params: z.object({ id: z.coerce.number().int() }) }, ...can('markets.write') }, async (req) => {
    await deps.engine.submit({ kind: 'RELOAD', marketId: req.params.id });
    await audit(req, 'admin.market.reload_book', 'MARKET', String(req.params.id));
    return { ok: true };
  });
  r.get('/options', { schema: { querystring: pageQuery.extend({ underlying: z.string().optional(), status: z.string().optional() }) }, ...can('markets.read') }, async (req) =>
    core.admin.optionContracts(req.query),
  );

  // ── fees ──
  r.get('/fees', can('fees.read'), async () => ({
    schedule: core.fees.scheduleList(),
    withdrawal: core.assets.list().flatMap((a) =>
      a.networks.map((n) => ({
        asset: a.symbol,
        network: n.network.code,
        withdrawalFee: n.withdrawalFee,
        minWithdrawal: n.minWithdrawal,
        minDeposit: n.minDeposit,
        depositEnabled: n.depositEnabled,
        withdrawEnabled: n.withdrawEnabled,
        confirmations: n.network.confirmations,
      })),
    ),
  }));
  r.put('/fees', { schema: { body: adminFeeScheduleSchema }, ...can('fees.write') }, async (req) => {
    await core.admin.setFeeSchedule(req.body.fees, requireSession(req).userId);
    await audit(req, 'admin.fees.schedule', 'FEES', null, req.body);
    return core.fees.scheduleList();
  });
  r.patch(
    '/assets/:asset/networks/:network',
    { schema: { params: z.object({ asset: z.string(), network: z.string() }), body: adminAssetNetworkSchema }, ...can('fees.write') },
    async (req) => {
      await core.admin.updateAssetNetwork(req.params.asset, req.params.network, req.body);
      await audit(req, 'admin.asset_network.update', 'ASSET', `${req.params.asset}:${req.params.network}`, req.body);
      return { ok: true };
    },
  );

  // ── orders & trades ──
  r.get('/orders', { schema: { querystring: adminOrdersQuery }, ...can('orders.read') }, async (req) => core.admin.orders(req.query));
  r.post('/orders/:id/cancel', { schema: { params: idParam, body: adminReasonSchema }, ...can('orders.cancel') }, async (req) => {
    const row = await admission.cancelOrder(requireSession(req).userId, req.params.id, 'ADMIN');
    await audit(req, 'admin.order.cancel', 'ORDER', req.params.id, req.body);
    return core.orders.toDto(row);
  });
  r.get('/trades', { schema: { querystring: adminListQuery.extend({ symbol: z.string().optional() }) }, ...can('orders.read') }, async (req) => core.admin.trades(req.query));
  r.get('/liquidations', { schema: { querystring: pageQuery }, ...can('risk.read') }, async (req) => {
    const rows = await core.db.query<Record<string, unknown>>(
      'SELECT l.*, u.email FROM liquidations l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ? OFFSET ?',
      [req.query.pageSize, (req.query.page - 1) * req.query.pageSize],
    );
    return rows.map((r2) => ({ ...r2, symbol: core.markets.byId(Number(r2.market_id))?.symbol }));
  });

  // ── wallet ──
  r.get('/deposits', { schema: { querystring: adminListQuery }, ...can('wallet.read') }, async (req) => core.admin.deposits(req.query));
  r.get('/withdrawals', { schema: { querystring: adminWithdrawalQuery }, ...can('wallet.read') }, async (req) => core.admin.withdrawals(req.query));
  r.post('/withdrawals/:id/review', { schema: { params: idParam, body: adminReviewWithdrawalSchema }, ...can('withdrawals.review') }, async (req) =>
    core.walletOps.reviewWithdrawal(requireSession(req).userId, req.params.id, req.body.decision, req.body.note),
  );
  r.get('/balances', can('wallet.read'), async () => ({ totals: await core.admin.balanceSheet(), system: await core.admin.systemWallets() }));

  // ── reports ──
  r.get('/reports/revenue', { schema: { querystring: adminReportQuery }, ...can('reports.read') }, async (req) => core.admin.revenue(req.query));
  r.get('/reports/transactions', { schema: { querystring: adminReportQuery }, ...can('reports.read') }, async (req) => core.admin.transactionReport(req.query));

  // ── security ──
  r.get('/security/logins', { schema: { querystring: adminListQuery }, ...can('security.read') }, async (req) => core.admin.logins(req.query));
  r.get('/security/alerts', { schema: { querystring: adminListQuery }, ...can('security.read') }, async (req) => core.admin.alerts(req.query));
  r.post('/security/alerts/:id/resolve', { schema: { params: idParam }, ...can('security.write') }, async (req) => {
    await core.admin.resolveAlert(req.params.id, requireSession(req).userId);
    await audit(req, 'admin.security.resolve_alert', 'ALERT', req.params.id);
    return { ok: true };
  });
  r.get('/security/ips', { schema: { querystring: z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) }) }, ...can('security.read') }, async (req) =>
    core.admin.ipMonitoring(req.query.hours),
  );
  r.get('/security/devices', { schema: { querystring: pageQuery }, ...can('security.read') }, async (req) => core.admin.deviceMonitoring(req.query));
  r.get('/security/2fa', can('security.read'), async () => core.admin.twoFactorStats());

  // ── roles / audit / settings / system ──
  r.get('/roles', can('roles.read'), async () => core.admin.roles());
  r.put('/roles/:code/permissions', { schema: { params: z.object({ code: z.string() }), body: adminRolePermissionsSchema }, ...can('roles.write') }, async (req) => {
    await core.admin.setRolePermissions(req.params.code as UserRole, req.body.permissions);
    await audit(req, 'admin.roles.update', 'ROLE', req.params.code, req.body);
    return core.admin.roles();
  });
  r.get('/audit-logs', { schema: { querystring: adminListQuery }, ...can('audit.read') }, async (req) => core.audit.list(req.query));
  r.get('/settings', can('settings.read'), async () => core.settings.all());
  r.put('/settings', { schema: { body: adminSettingsSchema }, ...can('settings.write') }, async (req) => {
    if (!core.settings.isKnown(req.body.key)) throw new AppError('VALIDATION_ERROR', `Unknown setting ${req.body.key}`);
    await core.settings.set(core.db, req.body.key, req.body.value, requireSession(req).userId);
    core.configChanged('settings');
    await audit(req, 'admin.settings.update', 'SETTING', req.body.key, { value: req.body.value });
    return core.settings.all();
  });
  r.get('/system/health', can('system.read'), async () => core.admin.systemHealth());
}
