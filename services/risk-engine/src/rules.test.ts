import { describe, expect, it } from 'vitest';
import { D } from '@gocrypto/trading-utils';
import {
  type PositionState,
  effectiveMargin,
  evaluateAccount,
  liquidationCheck,
} from '@gocrypto/server-core';
import { assertLeverageAllowed, bandedPrice, isTriggered, maxPositionNotional, scoreWithdrawal, triggerCondition } from './rules';

const tiers = [
  { tier: 1, maxNotional: '50000', maxLeverage: 125, maintenanceMarginRate: '0.004', maintenanceAmount: '0' },
  { tier: 2, maxNotional: '250000', maxLeverage: 100, maintenanceMarginRate: '0.005', maintenanceAmount: '50' },
  { tier: 3, maxNotional: '1000000', maxLeverage: 50, maintenanceMarginRate: '0.01', maintenanceAmount: '1300' },
];

const market = {
  id: 1,
  symbol: 'BTCUSDT-PERP',
  type: 'FUTURES' as const,
  displayName: 'BTCUSDT Perpetual',
  baseAssetId: 3,
  quoteAssetId: 1,
  base: 'BTC',
  quote: 'USDT',
  status: 'TRADING' as const,
  tickSize: '0.1',
  stepSize: '0.001',
  minQty: '0.001',
  maxQty: '1000',
  minNotional: '5',
  maxMarketQty: null,
  priceBand: '0.05',
  makerFeeRate: null,
  takerFeeRate: null,
  sortOrder: 1,
  futures: {
    underlyingAssetId: 3,
    underlying: 'BTC',
    settleAssetId: 1,
    settleAsset: 'USDT',
    contractSize: '1',
    maxLeverage: 125,
    defaultLeverage: 20,
    fundingIntervalHours: 8,
    interestRate: '0.0001',
    maxFundingRate: '0.0075',
    liquidationFeeRate: '0.005',
    maxPositionNotional: null,
    riskTiers: tiers,
  },
};

function pos(p: Partial<PositionState>): PositionState {
  return {
    id: '1',
    userId: '10',
    marketId: 1,
    side: 'LONG',
    qty: D('1'),
    entry: D('100000'),
    leverage: 10,
    marginMode: 'ISOLATED',
    margin: D('10000'),
    realizedPnl: D(0),
    fundingFees: D(0),
    status: 'OPEN',
    version: 1,
    openedAt: null,
    closedAt: null,
    dirty: false,
    ...p,
  };
}

describe('trigger rules', () => {
  it('uses stop / take-profit direction conventions', () => {
    expect(triggerCondition('STOP_MARKET', 'BUY')).toBe('GTE');
    expect(triggerCondition('STOP_LIMIT', 'SELL')).toBe('LTE');
    expect(triggerCondition('TAKE_PROFIT_MARKET', 'BUY')).toBe('LTE');
    expect(triggerCondition('TAKE_PROFIT_LIMIT', 'SELL')).toBe('GTE');
    expect(isTriggered('STOP_MARKET', 'SELL', '95', '94.9')).toBe(true);
    expect(isTriggered('STOP_MARKET', 'SELL', '95', '95.1')).toBe(false);
    expect(isTriggered('TAKE_PROFIT_MARKET', 'SELL', '110', '110')).toBe(true);
  });

  it('bands market-order reference prices', () => {
    expect(bandedPrice('BUY', '100', '0.05').toFixed()).toBe('105');
    expect(bandedPrice('SELL', '100', '0.05').toFixed()).toBe('95');
  });
});

describe('leverage and position limits', () => {
  it('caps leverage by risk tier', () => {
    expect(assertLeverageAllowed(tiers, '40000', 125)).toEqual({ ok: true });
    expect(assertLeverageAllowed(tiers, '100000', 125)).toEqual({ ok: false, max: 100 });
    expect(assertLeverageAllowed(tiers, '600000', 75)).toEqual({ ok: false, max: 50 });
    expect(maxPositionNotional(tiers)?.toFixed()).toBe('1000000');
  });
});

describe('liquidation rules', () => {
  it('liquidates an isolated position once margin + uPnL <= maintenance', () => {
    const p = pos({});
    const safe = evaluateAccount({ available: D(0), locked: D('10000') }, [{ pos: p, market, mark: D('95000') }], D(0));
    expect(liquidationCheck([p], safe)).toEqual([]);
    // mark 90 400: uPnL -9 600, equity 400 <= mm (90 400 * 0.5% - 50 = 402)
    const bad = evaluateAccount({ available: D(0), locked: D('10000') }, [{ pos: p, market, mark: D('90400') }], D(0));
    expect(liquidationCheck([p], bad)).toEqual([{ liquidate: true, mode: 'ISOLATED', positionIds: ['1'] }]);
  });

  it('evaluates cross positions against the whole cross balance', () => {
    const a = pos({ id: 'a', marginMode: 'CROSS', margin: D('5000'), qty: D('1'), entry: D('100000') });
    const wallet = { available: D('1000'), locked: D('5000') };
    const ok = evaluateAccount(wallet, [{ pos: a, market, mark: D('96000') }], D(0));
    expect(liquidationCheck([a], ok)).toEqual([]);
    // wallet 6 000 - 5 700 loss = 300 < mm (94 300*0.5%-50 = 421.5)
    const bad = evaluateAccount(wallet, [{ pos: a, market, mark: D('94300') }], D(0));
    expect(liquidationCheck([a], bad)[0]).toMatchObject({ liquidate: true, mode: 'CROSS' });
    expect(effectiveMargin(a, ok).toFixed()).toBe('6000');
  });
});

describe('withdrawal risk scoring', () => {
  it('flags large withdrawals to new addresses for review', () => {
    const r = scoreWithdrawal({
      amountUsd: D('15000'),
      reviewThresholdUsd: D('10000'),
      newAddress: true,
      newAddressReview: true,
      accountAgeDays: 100,
      twoFactorEnabled: true,
      balanceUsd: D('100000'),
      withdrawalsLast24h: 0,
      kycLevel: 2,
    });
    expect(r.requiresReview).toBe(true);
    expect(r.flags).toEqual(['LARGE_AMOUNT', 'NEW_ADDRESS']);
  });

  it('lets routine withdrawals through', () => {
    const r = scoreWithdrawal({
      amountUsd: D('100'),
      reviewThresholdUsd: D('10000'),
      newAddress: false,
      newAddressReview: true,
      accountAgeDays: 400,
      twoFactorEnabled: true,
      balanceUsd: D('100000'),
      withdrawalsLast24h: 1,
      kycLevel: 2,
    });
    expect(r).toEqual({ score: 0, flags: [], requiresReview: false });
  });
});
