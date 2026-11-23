import type { MarketDto } from '@gocrypto/shared-types';
import {
  adminCreateFuturesMarketSchema,
  adminCreateSpotMarketSchema,
  adminFeeScheduleSchema,
  adminRiskTiersSchema,
  adminRolePermissionsSchema,
  adminUpdateMarketSchema,
} from '@gocrypto/validation';
import { describe, expect, it } from 'vitest';
import { diffSchedule } from '../pages/FeesPage';
import { roleChanges } from '../pages/RolesPage';
import { buildCreatePayload } from '../pages/markets/CreateMarketDialog';
import { buildMarketPatch } from '../pages/markets/MarketEditDialog';
import { continuousMaintenanceAmounts } from '../pages/markets/RiskTiersDialog';

/**
 * Contract tests: request bodies built by the console must pass the exact zod schemas the API
 * validates with (@gocrypto/validation), so a UI change cannot silently start producing 400s.
 */
const form = {
  base: 'LINK',
  quote: 'USDT',
  status: 'PRE_TRADING' as const,
  tickSize: '0.001',
  stepSize: '0.01',
  minQty: '0.01',
  maxQty: '100000',
  minNotional: '5',
  priceBand: '0.05',
  makerFeeRate: '',
  takerFeeRate: '0.0008',
  maxLeverage: '50',
  defaultLeverage: '10',
  fundingIntervalHours: '8',
};

describe('API request contracts', () => {
  it('spot market creation', () => {
    const body = buildCreatePayload('SPOT', form);
    expect(adminCreateSpotMarketSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty('makerFeeRate', '');
  });

  it('futures market creation', () => {
    const body = buildCreatePayload('FUTURES', form);
    const parsed = adminCreateFuturesMarketSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body).toMatchObject({ underlying: 'LINK', settleAsset: 'USDT', maxLeverage: 50, defaultLeverage: 10, fundingIntervalHours: 8 });
  });

  it('market update patch (including clearing an override)', () => {
    const market = {
      id: 3,
      status: 'TRADING',
      tickSize: '0.01',
      stepSize: '0.001',
      minQty: '0.001',
      maxQty: '1000000',
      minNotional: '5',
      priceBand: '0.05',
      makerFeeRate: '0.0005',
      takerFeeRate: '0',
    } as unknown as MarketDto;
    const patch = buildMarketPatch(market, {
      status: 'HALTED',
      tickSize: '0.01',
      stepSize: '0.001',
      minQty: '0.001',
      maxQty: '500000',
      minNotional: '5',
      priceBand: '0.1',
      makerFeeRate: '',
      takerFeeRate: '0.0007',
      maxLeverage: '',
      defaultLeverage: '',
    });
    expect(patch).toEqual({ status: 'HALTED', maxQty: '500000', priceBand: '0.1', makerFeeRate: null, takerFeeRate: '0.0007' });
    expect(adminUpdateMarketSchema.safeParse(patch).success).toBe(true);
  });

  it('fee schedule upsert', () => {
    const { changes } = diffSchedule({ 'SPOT:0': { maker: '0.001', taker: '0.001' } }, { 'SPOT:0': { maker: '-0.0001', taker: '0.0009' }, 'FUTURES:4': { maker: '0.0001', taker: '0.0003' } });
    expect(changes).toHaveLength(2);
    expect(adminFeeScheduleSchema.safeParse({ fees: changes }).success).toBe(true);
  });

  it('risk tiers with derived maintenance amounts', () => {
    const rows = [
      { maxNotional: '10000', maxLeverage: 100, maintenanceMarginRate: '0.005' },
      { maxNotional: '100000', maxLeverage: 50, maintenanceMarginRate: '0.01' },
    ];
    const amounts = continuousMaintenanceAmounts(rows) ?? [];
    const tiers = rows.map((r, i) => ({ tier: i + 1, ...r, maintenanceAmount: amounts[i] ?? '0' }));
    expect(amounts).toEqual(['0', '50']);
    expect(adminRiskTiersSchema.safeParse({ tiers }).success).toBe(true);
  });

  it('role permission update', () => {
    const [change] = roleChanges([{ code: 'SUPPORT', name: 'Support', description: null, isSystem: true, permissions: ['users.read'] }], { SUPPORT: ['users.read', 'security.write'] });
    expect(adminRolePermissionsSchema.safeParse({ permissions: change?.permissions }).success).toBe(true);
  });
});
