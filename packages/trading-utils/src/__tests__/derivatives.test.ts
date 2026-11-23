import { describe, expect, it } from 'vitest';
import {
  type RiskTier,
  D,
  averageEntryPrice,
  bankruptcyPrice,
  blackScholesPrice,
  fundingPayment,
  fundingRate,
  greeks,
  impliedVolatility,
  initialMargin,
  liquidationPrice,
  maintenanceMargin,
  normCdf,
  optionPayoff,
  realizedPnl,
  shortOptionInitialMargin,
  tierForNotional,
  unrealizedPnl,
} from '../index';

const tiers: RiskTier[] = [
  { tier: 1, maxNotional: '50000', maxLeverage: 125, maintenanceMarginRate: '0.004', maintenanceAmount: '0' },
  { tier: 2, maxNotional: '250000', maxLeverage: 100, maintenanceMarginRate: '0.005', maintenanceAmount: '50' },
  { tier: 3, maxNotional: '1000000', maxLeverage: 50, maintenanceMarginRate: '0.01', maintenanceAmount: '1300' },
];
const flat: RiskTier[] = [
  { tier: 1, maxNotional: '1000000000', maxLeverage: 100, maintenanceMarginRate: '0.005', maintenanceAmount: '0' },
];

describe('futures math', () => {
  it('computes PnL for longs and shorts', () => {
    expect(unrealizedPnl('LONG', '2', '100', '110').toFixed()).toBe('20');
    expect(unrealizedPnl('SHORT', '2', '100', '110').toFixed()).toBe('-20');
    expect(realizedPnl('SHORT', '1.5', '100', '90').toFixed()).toBe('15');
  });

  it('computes initial margin rounded up', () => {
    expect(initialMargin('100', 3).toFixed()).toBe('33.333333333333333334');
    expect(initialMargin('5000', 10).toFixed()).toBe('500');
  });

  it('selects risk tiers by notional', () => {
    expect(tierForNotional(tiers, '10000').tier).toBe(1);
    expect(tierForNotional(tiers, '50000').tier).toBe(1);
    expect(tierForNotional(tiers, '50000.01').tier).toBe(2);
    expect(tierForNotional(tiers, '99999999').tier).toBe(3);
    expect(maintenanceMargin(tiers, '2', '50000').toFixed()).toBe('450'); // 100k * 0.5% - 50
  });

  it('computes isolated liquidation prices', () => {
    const long = liquidationPrice({ side: 'LONG', qty: '1', entryPrice: '100', margin: '10', tiers: flat });
    expect(long?.toFixed()).toBe('90.45226131');
    const short = liquidationPrice({ side: 'SHORT', qty: '1', entryPrice: '100', margin: '10', tiers: flat });
    expect(short?.toFixed()).toBe('109.45273631');
    // At the liquidation price, equity equals maintenance margin.
    const lp = D(long!);
    const equity = D('10').plus(unrealizedPnl('LONG', '1', '100', lp));
    expect(equity.minus(lp.mul('0.005')).abs().lt('0.00000001')).toBe(true);
  });

  it('returns null when a position cannot be liquidated', () => {
    expect(liquidationPrice({ side: 'LONG', qty: '1', entryPrice: '100', margin: '200', tiers: flat })).toBeNull();
  });

  it('computes bankruptcy price and average entry', () => {
    expect(bankruptcyPrice('LONG', '1', '100', '10').toFixed()).toBe('90');
    expect(bankruptcyPrice('SHORT', '2', '100', '10').toFixed()).toBe('105');
    expect(averageEntryPrice('1', '100', '1', '110').toFixed()).toBe('105');
  });

  it('computes funding', () => {
    expect(fundingPayment('LONG', '2', '100', '0.0001').toFixed()).toBe('-0.02');
    expect(fundingPayment('SHORT', '2', '100', '0.0001').toFixed()).toBe('0.02');
    expect(fundingRate('0').toFixed()).toBe('0.0001');
    expect(fundingRate('0.001').toFixed()).toBe('0.0005'); // P + clamp(I-P) = 0.001 - 0.0005
    expect(fundingRate('0.5').toFixed()).toBe('0.0075'); // capped
  });
});

describe('options math', () => {
  it('matches textbook Black-Scholes values', () => {
    const base = { spot: 100, strike: 100, timeToExpiry: 1, volatility: 0.2, rate: 0.05 };
    expect(blackScholesPrice({ ...base, type: 'CALL' })).toBeCloseTo(10.4506, 3);
    expect(blackScholesPrice({ ...base, type: 'PUT' })).toBeCloseTo(5.5735, 3);
    const g = greeks({ ...base, type: 'CALL' });
    expect(g.delta).toBeCloseTo(0.6368, 3);
    expect(g.gamma).toBeCloseTo(0.01876, 4);
    expect(g.vega).toBeCloseTo(0.3752, 3);
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('satisfies put-call parity', () => {
    const p = { spot: 30000, strike: 32000, timeToExpiry: 0.25, volatility: 0.7, rate: 0.03 };
    const call = blackScholesPrice({ ...p, type: 'CALL' });
    const put = blackScholesPrice({ ...p, type: 'PUT' });
    expect(call - put).toBeCloseTo(p.spot - p.strike * Math.exp(-p.rate * p.timeToExpiry), 6);
  });

  it('recovers implied volatility', () => {
    const p = { type: 'CALL' as const, spot: 60000, strike: 65000, timeToExpiry: 30 / 365, rate: 0 };
    const price = blackScholesPrice({ ...p, volatility: 0.55 });
    expect(impliedVolatility(price, p)).toBeCloseTo(0.55, 5);
    expect(impliedVolatility(70000, p)).toBeNull();
  });

  it('computes short option margin and payoff', () => {
    // call: max(0.15*S - OTM, 0.1*S) + mark = max(9000 - 5000, 6000) + 100 = 6100
    const m = shortOptionInitialMargin({ type: 'CALL', indexPrice: '60000', strike: '65000', markPrice: '100', qty: '1' });
    expect(m.toFixed()).toBe('6100');
    expect(optionPayoff('CALL', '70000', '65000').toFixed()).toBe('5000');
    expect(optionPayoff('PUT', '70000', '65000').toFixed()).toBe('0');
  });
});
