import type { MarketDto } from '@gocrypto/shared-types';
import { describe, expect, it } from 'vitest';
import { buildMarketPatch } from '../pages/markets/MarketEditDialog';
import { continuousMaintenanceAmounts } from '../pages/markets/RiskTiersDialog';
import { diffSchedule } from '../pages/FeesPage';
import { revenueTotals } from '../pages/ReportsPage';
import { kindOf, validateSettingInput } from '../pages/SettingsPage';
import { liabilityRows } from '../pages/wallet/BalancesView';
import { toCsv } from './csv';
import { fmtAmount, fmtBytes, fmtDuration, fmtRate, fmtUsd, fmtUsdCompact, toMs } from './format';
import { hourlyBuckets } from './series';
import { validateRate } from './validators';

describe('format helpers', () => {
  it('formats decimal strings exactly', () => {
    expect(fmtAmount('1500.500000000000000000')).toBe('1,500.5');
    expect(fmtAmount('0.000000012345', 8)).toBe('0.00000001');
    expect(fmtAmount('not a number')).toBe('—');
    expect(fmtUsd(null)).toBe('—');
    expect(fmtUsd('-12.5')).toBe('-$12.50');
    expect(fmtUsdCompact('1234567.89')).toBe('$1.23M');
    expect(fmtUsdCompact('950.2')).toBe('$950.20');
  });

  it('renders fee rates as percentages', () => {
    expect(fmtRate('0.001')).toBe('0.1%');
    expect(fmtRate('0.00016')).toBe('0.016%');
    expect(fmtRate('-0.0001')).toBe('-0.01%');
  });

  it('parses timestamps from epoch ms and ISO strings', () => {
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMs('2026-11-23T10:00:00.000Z')).toBe(Date.UTC(2026, 10, 23, 10));
    expect(toMs('garbage')).toBeNull();
    expect(toMs(null)).toBeNull();
  });

  it('formats durations and bytes', () => {
    expect(fmtDuration(90_061)).toBe('1d 1h');
    expect(fmtDuration(3_720)).toBe('1h 2m');
    expect(fmtBytes(1_536)).toBe('1.5 KB');
    expect(fmtBytes(512 * 1024 * 1024)).toBe('512 MB');
  });
});

describe('validators', () => {
  it('mirrors the API fee rate rules', () => {
    expect(validateRate('0.001', false)).toBeNull();
    expect(validateRate('-0.0001', true)).toBeNull();
    expect(validateRate('-0.0001', false)).not.toBeNull();
    expect(validateRate('0.1', false)).toBe('Must be below 0.1 (10%)');
    expect(validateRate('', true)).toBe('Required');
    expect(validateRate('1e-3', true)).not.toBeNull();
  });
});

describe('fee schedule diff', () => {
  const original = { 'SPOT:0': { maker: '0.001', taker: '0.001' } } as const;
  it('emits only changed, valid rows', () => {
    const { changes, errors } = diffSchedule(original, {
      'SPOT:0': { maker: '0.0009', taker: '0.001' },
      'FUTURES:1': { maker: '', taker: '' },
    });
    expect(errors).toEqual({});
    expect(changes).toEqual([{ marketType: 'SPOT', vipTier: 0, makerRate: '0.0009', takerRate: '0.001' }]);
  });
  it('flags incomplete new rows', () => {
    const { changes, errors } = diffSchedule(original, { 'SPOT:0': { maker: '0.001', taker: '0.001' }, 'OPTIONS:2': { maker: '0.0002', taker: '' } });
    expect(changes).toEqual([]);
    expect(errors['OPTIONS:2:taker']).toBe('Required');
  });
});

describe('risk tiers', () => {
  it('derives continuous maintenance amounts like the seed data', () => {
    const tiers = [
      { maxNotional: '50000', maintenanceMarginRate: '0.004' },
      { maxNotional: '250000', maintenanceMarginRate: '0.005' },
      { maxNotional: '1000000', maintenanceMarginRate: '0.01' },
      { maxNotional: '5000000', maintenanceMarginRate: '0.025' },
      { maxNotional: '20000000', maintenanceMarginRate: '0.05' },
      { maxNotional: '100000000', maintenanceMarginRate: '0.1' },
    ];
    expect(continuousMaintenanceAmounts(tiers)).toEqual(['0', '50', '1300', '16300', '141300', '1141300']);
    expect(continuousMaintenanceAmounts([{ maxNotional: '1', maintenanceMarginRate: 'x' }])).toBeNull();
  });
});

describe('market edit patch', () => {
  const market = {
    id: 7,
    symbol: 'BTCUSDT-PERP',
    status: 'TRADING',
    tickSize: '0.1',
    stepSize: '0.001',
    minQty: '0.001',
    maxQty: '1000',
    minNotional: '5',
    priceBand: '0.05',
    makerFeeRate: '0',
    takerFeeRate: '0.0004',
    futures: { maxLeverage: 125, defaultLeverage: 20, riskTiers: [] },
  } as unknown as MarketDto;
  const form = { status: 'TRADING' as const, tickSize: '0.1', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5', priceBand: '0.05', makerFeeRate: '', takerFeeRate: '0.0004', maxLeverage: '125', defaultLeverage: '20' };

  it('sends nothing when unchanged', () => {
    expect(buildMarketPatch(market, form)).toEqual({});
  });
  it('sends only changed fields and clears overrides with null', () => {
    expect(buildMarketPatch(market, { ...form, status: 'HALTED', takerFeeRate: '', maxLeverage: '100' })).toEqual({ status: 'HALTED', takerFeeRate: null, maxLeverage: 100 });
  });
});

describe('settings validation', () => {
  it('detects value kinds', () => {
    expect(kindOf(true)).toBe('boolean');
    expect(kindOf(200)).toBe('integer');
    expect(kindOf('10000')).toBe('decimal');
    expect(kindOf({ '0': '2000', '1': '50000' })).toBe('decimal-map');
  });
  it('keeps the shape the services expect', () => {
    expect(validateSettingInput('10000', '"25000"')).toEqual({ ok: true, value: '25000' });
    expect(validateSettingInput('10000', '25000')).toMatchObject({ ok: false });
    expect(validateSettingInput(true, 'false')).toEqual({ ok: true, value: false });
    expect(validateSettingInput(true, '"no"')).toMatchObject({ ok: false });
    expect(validateSettingInput(5, '-1')).toMatchObject({ ok: false });
    expect(validateSettingInput({ '0': '2000', '1': '50000' }, '{"0":"2500"}')).toMatchObject({ ok: false, error: 'Missing key(s): 1' });
    expect(validateSettingInput({ '0': '2000' }, '{"0": 2500}')).toMatchObject({ ok: false });
    expect(validateSettingInput('x', '{oops')).toMatchObject({ ok: false });
  });
});

describe('reports & balances aggregation', () => {
  it('totals revenue per fee asset', () => {
    const totals = revenueTotals([
      { period: '2026-11-01', marketType: 'SPOT', asset: 'USDT', fees: '1.5', trades: 3, volume: '1500', volumeAsset: 'USDT' },
      { period: '2026-11-02', marketType: 'FUTURES', asset: 'USDT', fees: '0.25', trades: 1, volume: '500', volumeAsset: 'USDT' },
      { period: '2026-11-02', marketType: 'WITHDRAWAL', asset: 'USDT', fees: '1', trades: 1, volume: '100', volumeAsset: 'USDT' },
      { period: '2026-11-02', marketType: 'SPOT', asset: 'BTC', fees: '0.0001', trades: 2, volume: '200', volumeAsset: 'USDT' },
    ]);
    expect(totals).toEqual([
      { asset: 'BTC', tradingFees: '0.0001', withdrawalFees: '0', totalFees: '0.0001', fills: 2, withdrawals: 0 },
      { asset: 'USDT', tradingFees: '1.75', withdrawalFees: '1', totalFees: '2.75', fills: 4, withdrawals: 1 },
    ]);
  });

  it('adds per-asset subtotal rows to the liability sheet', () => {
    const rows = liabilityRows([
      { asset: 'USDT', account: 'SPOT', available: '100.5', locked: '10', total: '110.5', users: 3 },
      { asset: 'USDT', account: 'FUTURES', available: '50', locked: '0', total: '50', users: 1 },
      { asset: 'BTC', account: 'SPOT', available: '1', locked: '0.5', total: '1.5', users: 2 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(['BTC:SPOT', 'USDT:FUTURES', 'USDT:SPOT', 'USDT:total']);
    expect(rows[3]).toMatchObject({ subtotal: true, available: '150.5', locked: '10', total: '160.5', wallets: 4 });
  });
});

describe('chart series', () => {
  it('fills a gap-free hourly window', () => {
    const now = Date.UTC(2026, 10, 23, 12, 30);
    const buckets = hourlyBuckets([{ t: Date.UTC(2026, 10, 23, 11), volumeUsd: '1000.5' }], now);
    expect(buckets).toHaveLength(25);
    expect(buckets[buckets.length - 1]).toEqual({ time: Date.UTC(2026, 10, 23, 12) / 1000, value: 0 });
    expect(buckets[buckets.length - 2]).toEqual({ time: Date.UTC(2026, 10, 23, 11) / 1000, value: 1000.5 });
  });
});

describe('csv export', () => {
  it('escapes and neutralises spreadsheet formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=SUM(A1)'], ['-1.5', '-x']])).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n-1.5,\'-x');
  });
});
