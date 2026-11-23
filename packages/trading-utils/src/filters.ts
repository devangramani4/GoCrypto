import { D, type DecimalLike, isMultipleOf } from './decimal';

/** Exchange filters configured per market (all values decimal strings). */
export interface MarketFilters {
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  /** Optional cap for market orders; falls back to maxQty. */
  maxMarketQty?: string | null;
}

export type FilterViolation =
  | 'PRICE_NOT_POSITIVE'
  | 'PRICE_TICK_SIZE'
  | 'QTY_NOT_POSITIVE'
  | 'QTY_STEP_SIZE'
  | 'QTY_BELOW_MIN'
  | 'QTY_ABOVE_MAX'
  | 'NOTIONAL_BELOW_MIN';

export const FILTER_MESSAGES: Record<FilterViolation, string> = {
  PRICE_NOT_POSITIVE: 'Price must be greater than zero',
  PRICE_TICK_SIZE: 'Price does not match the market tick size',
  QTY_NOT_POSITIVE: 'Quantity must be greater than zero',
  QTY_STEP_SIZE: 'Quantity does not match the market step size',
  QTY_BELOW_MIN: 'Quantity is below the market minimum',
  QTY_ABOVE_MAX: 'Quantity is above the market maximum',
  NOTIONAL_BELOW_MIN: 'Order value is below the minimum notional',
};

export function checkPrice(price: DecimalLike, filters: Pick<MarketFilters, 'tickSize'>): FilterViolation | null {
  const p = D(price);
  if (!p.isFinite() || p.lte(0)) return 'PRICE_NOT_POSITIVE';
  if (!isMultipleOf(p, filters.tickSize)) return 'PRICE_TICK_SIZE';
  return null;
}

export function checkQuantity(
  qty: DecimalLike,
  filters: Pick<MarketFilters, 'stepSize' | 'minQty' | 'maxQty' | 'maxMarketQty'>,
  isMarket = false,
): FilterViolation | null {
  const q = D(qty);
  if (!q.isFinite() || q.lte(0)) return 'QTY_NOT_POSITIVE';
  if (!isMultipleOf(q, filters.stepSize)) return 'QTY_STEP_SIZE';
  if (q.lt(filters.minQty)) return 'QTY_BELOW_MIN';
  const max = isMarket && filters.maxMarketQty ? filters.maxMarketQty : filters.maxQty;
  if (D(max).gt(0) && q.gt(max)) return 'QTY_ABOVE_MAX';
  return null;
}

export function checkNotional(
  price: DecimalLike,
  qty: DecimalLike,
  filters: Pick<MarketFilters, 'minNotional'>,
): FilterViolation | null {
  if (D(price).mul(qty).lt(filters.minNotional)) return 'NOTIONAL_BELOW_MIN';
  return null;
}

/** Validate a limit-style order against every filter; returns the first violation or null. */
export function validateLimitOrder(price: DecimalLike, qty: DecimalLike, filters: MarketFilters): FilterViolation | null {
  return checkPrice(price, filters) ?? checkQuantity(qty, filters) ?? checkNotional(price, qty, filters);
}
