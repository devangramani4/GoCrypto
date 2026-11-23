import { describe, expect, it } from 'vitest';
import {
  D,
  ceilToStep,
  checkNotional,
  checkPrice,
  checkQuantity,
  dsum,
  floorToStep,
  formatCompact,
  formatNumber,
  formatPercent,
  isDecimalString,
  isMultipleOf,
  q18,
  q18Up,
  toDb,
  toPlain,
  validateLimitOrder,
} from '../index';

describe('decimal helpers', () => {
  it('never suffers from binary floating point drift', () => {
    expect(D('0.1').plus('0.2').toFixed()).toBe('0.3');
    expect(dsum(['0.1', '0.2', '0.3']).toFixed()).toBe('0.6');
    expect(D('1e-18').plus('1').toFixed()).toBe('1.000000000000000001');
  });

  it('serialises for db and api', () => {
    expect(toDb('1.5')).toBe('1.500000000000000000');
    expect(toPlain('1.500000000000000000')).toBe('1.5');
    expect(toPlain('0.000000000000000000')).toBe('0');
    expect(toPlain('12345678901234567890.123456789012345678')).toBe('12345678901234567890.123456789012345678');
  });

  it('quantises to 18dp with directional rounding', () => {
    expect(q18('0.1234567890123456789').toFixed()).toBe('0.123456789012345678');
    expect(q18Up('0.1234567890123456781').toFixed()).toBe('0.123456789012345679');
  });

  it('rounds to steps', () => {
    expect(floorToStep('1.23456', '0.001').toFixed()).toBe('1.234');
    expect(ceilToStep('1.23401', '0.001').toFixed()).toBe('1.235');
    expect(isMultipleOf('0.30', '0.01')).toBe(true);
    expect(isMultipleOf('0.305', '0.01')).toBe(false);
  });

  it('validates decimal strings', () => {
    expect(isDecimalString('1.5')).toBe(true);
    expect(isDecimalString('-0.0001')).toBe(true);
    expect(isDecimalString('abc')).toBe(false);
    expect(isDecimalString('1.2.3')).toBe(false);
    expect(isDecimalString('')).toBe(false);
    expect(isDecimalString('Infinity')).toBe(false);
  });
});

describe('market filters', () => {
  const filters = { tickSize: '0.01', stepSize: '0.0001', minQty: '0.0001', maxQty: '100', minNotional: '5' };

  it('accepts a valid order', () => {
    expect(validateLimitOrder('50000.01', '0.0010', filters)).toBeNull();
  });

  it('rejects tick, step, min/max and notional violations', () => {
    expect(checkPrice('50000.001', filters)).toBe('PRICE_TICK_SIZE');
    expect(checkPrice('0', filters)).toBe('PRICE_NOT_POSITIVE');
    expect(checkQuantity('0.00015', filters)).toBe('QTY_STEP_SIZE');
    expect(checkQuantity('0', filters)).toBe('QTY_NOT_POSITIVE');
    expect(checkQuantity('101', filters)).toBe('QTY_ABOVE_MAX');
    expect(checkNotional('10', '0.1', filters)).toBe('NOTIONAL_BELOW_MIN');
  });
});

describe('formatting', () => {
  it('formats exactly with grouping', () => {
    expect(formatNumber('1234567.891', 2)).toBe('1,234,567.89');
    expect(formatNumber('-1234.5', 2)).toBe('-1,234.50');
    expect(formatNumber('0.000123', 8, { trim: true })).toBe('0.000123');
    expect(formatNumber('5', 2, { sign: true })).toBe('+5.00');
    expect(formatPercent('0.0523')).toBe('+5.23%');
    expect(formatPercent('-0.1')).toBe('-10.00%');
    expect(formatCompact('1530000')).toBe('1.53M');
  });
});
