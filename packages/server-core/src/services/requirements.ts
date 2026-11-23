import { D, type Decimal, type DecimalLike, ONE, ZERO, initialMargin, q18Up, shortOptionInitialMargin } from '@gocrypto/trading-utils';
import type { MarketInfo } from '../cache/markets';

/**
 * Funds reserved when an order is accepted (the "lock"). Shared by the risk engine (order entry)
 * and the matching engine (amendments) so both compute identical requirements.
 */

/** Spot: buys lock quote (price * qty), sells lock base (qty). */
export function spotReserve(side: 'BUY' | 'SELL', qty: DecimalLike, price: DecimalLike | null, quoteQty?: DecimalLike | null): Decimal {
  if (side === 'SELL') return D(qty);
  if (quoteQty) return D(quoteQty);
  return q18Up(D(qty).mul(price ?? 0));
}

/**
 * Futures: initial margin for the full quantity at the worst price inside the protection band
 * (sells can execute above their limit) plus the taker fee. Reduce-only orders reserve nothing.
 */
export function futuresReserve(params: {
  market: MarketInfo;
  side: 'BUY' | 'SELL';
  qty: DecimalLike;
  price: DecimalLike;
  leverage: number;
  takerRate: DecimalLike;
  reduceOnly: boolean;
}): Decimal {
  if (params.reduceOnly) return ZERO;
  const band = D(params.market.priceBand);
  const worst = params.side === 'SELL' ? D(params.price).mul(ONE.plus(band)) : D(params.price);
  const notional = D(params.qty).mul(worst);
  return q18Up(initialMargin(notional, params.leverage).plus(notional.mul(params.takerRate)));
}

/** Options: buys reserve premium + fee; opening sells reserve short-option initial margin + fee. */
export function optionsReserve(params: {
  market: MarketInfo;
  side: 'BUY' | 'SELL';
  qty: DecimalLike;
  price: DecimalLike;
  indexPrice: DecimalLike;
  markPrice: DecimalLike;
  feeRate: DecimalLike;
  /** Quantity of an existing long that a sell would close (needs no margin). */
  closableLong?: DecimalLike;
  /** Quantity of an existing short that a buy would close. */
  closableShort?: DecimalLike;
}): Decimal {
  const qty = D(params.qty);
  const fee = D(params.indexPrice).mul(qty).mul(params.feeRate);
  if (params.side === 'BUY') {
    return q18Up(qty.mul(params.price).plus(fee));
  }
  const opening = qty.minus(D(params.closableLong ?? 0));
  if (opening.lte(0)) return q18Up(fee);
  const margin = shortOptionInitialMargin({
    type: params.market.option!.optionType,
    indexPrice: params.indexPrice,
    strike: params.market.option!.strike,
    markPrice: D(params.markPrice).gt(params.price) ? params.markPrice : params.price,
    qty: opening,
  });
  return q18Up(margin.plus(fee));
}
