import type { OrderSide, OrderType } from '@gocrypto/shared-types';
import { D, type Decimal, type DecimalLike, ONE, type RiskTier, maxLeverageForNotional, tierForNotional } from '@gocrypto/trading-utils';

/** Pure pre-trade rules (no IO) — unit tested independently of the database. */

export const MARKET_ORDER_TYPES: readonly OrderType[] = ['MARKET', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'];
export const TRIGGER_ORDER_TYPES: readonly OrderType[] = ['STOP_MARKET', 'STOP_LIMIT', 'TAKE_PROFIT_MARKET', 'TAKE_PROFIT_LIMIT'];

export function isMarketType(t: OrderType): boolean {
  return MARKET_ORDER_TYPES.includes(t);
}

export function isTriggerType(t: OrderType): boolean {
  return TRIGGER_ORDER_TYPES.includes(t);
}

/**
 * Trigger direction convention:
 *   STOP_*        BUY triggers when price >= stop, SELL when price <= stop
 *   TAKE_PROFIT_* BUY triggers when price <= stop, SELL when price >= stop
 */
export function triggerCondition(type: OrderType, side: OrderSide): 'GTE' | 'LTE' {
  const isStop = type.startsWith('STOP');
  if (isStop) return side === 'BUY' ? 'GTE' : 'LTE';
  return side === 'BUY' ? 'LTE' : 'GTE';
}

export function isTriggered(type: OrderType, side: OrderSide, stopPrice: DecimalLike, price: DecimalLike): boolean {
  return triggerCondition(type, side) === 'GTE' ? D(price).gte(stopPrice) : D(price).lte(stopPrice);
}

/** Price used to size the reservation of a market-style order: reference price moved by the protection band. */
export function bandedPrice(side: OrderSide, reference: DecimalLike, band: DecimalLike): Decimal {
  const b = D(band);
  return side === 'BUY' ? D(reference).mul(ONE.plus(b)) : D(reference).mul(ONE.minus(b));
}

/** Leverage allowed for the resulting position notional (risk-limit tiers). */
export function assertLeverageAllowed(tiers: readonly RiskTier[], positionNotional: DecimalLike, leverage: number): { ok: true } | { ok: false; max: number } {
  if (!tiers.length) return { ok: true };
  const max = maxLeverageForNotional(tiers, positionNotional);
  return leverage <= max ? { ok: true } : { ok: false, max };
}

/** Maximum position notional a contract allows (top risk tier bound). */
export function maxPositionNotional(tiers: readonly RiskTier[]): Decimal | null {
  if (!tiers.length) return null;
  return D([...tiers].sort((a, b) => b.tier - a.tier)[0]!.maxNotional);
}

export function riskTierFor(tiers: readonly RiskTier[], notional: DecimalLike): RiskTier | null {
  return tiers.length ? tierForNotional(tiers, notional) : null;
}

export { scoreWithdrawal, type WithdrawalRiskInput, type WithdrawalRiskResult } from '@gocrypto/server-core';
