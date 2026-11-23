import { z } from 'zod';
import { CHART_TIMEFRAMES, MARGIN_MODES, ORDER_SIDES, ORDER_STATUSES, ORDER_TYPES, TIME_IN_FORCE } from '@gocrypto/shared-types';
import { clientOrderId, cursorQuery, marketTypeSchema, positiveDecimal, symbolSchema, timeRangeQuery } from './common';

const LIMIT_TYPES = ['LIMIT', 'STOP_LIMIT', 'TAKE_PROFIT_LIMIT'] as const;
const TRIGGER_TYPES = ['STOP_MARKET', 'STOP_LIMIT', 'TAKE_PROFIT_MARKET', 'TAKE_PROFIT_LIMIT'] as const;

export function isLimitType(type: string): boolean {
  return (LIMIT_TYPES as readonly string[]).includes(type);
}

export function isTriggerType(type: string): boolean {
  return (TRIGGER_TYPES as readonly string[]).includes(type);
}

const baseOrder = {
  symbol: symbolSchema,
  side: z.enum(ORDER_SIDES),
  type: z.enum(ORDER_TYPES),
  timeInForce: z.enum(TIME_IN_FORCE).optional(),
  price: positiveDecimal.optional(),
  stopPrice: positiveDecimal.optional(),
  quantity: positiveDecimal.optional(),
  clientOrderId: clientOrderId.optional(),
  postOnly: z.boolean().optional(),
};

type OrderShape = {
  type: (typeof ORDER_TYPES)[number];
  side: (typeof ORDER_SIDES)[number];
  timeInForce?: (typeof TIME_IN_FORCE)[number] | undefined;
  price?: string | undefined;
  stopPrice?: string | undefined;
  quantity?: string | undefined;
  quoteQuantity?: string | undefined;
  postOnly?: boolean | undefined;
  closePosition?: boolean | undefined;
};

function refineOrderShape(o: OrderShape, ctx: z.RefinementCtx): void {
  const needsPrice = isLimitType(o.type);
  const needsStop = isTriggerType(o.type);
  if (needsPrice && !o.price) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Price is required' });
  if (!needsPrice && o.price) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'Price is not allowed for market-style orders' });
  }
  if (needsStop && !o.stopPrice) ctx.addIssue({ code: 'custom', path: ['stopPrice'], message: 'Trigger price is required' });
  if (!needsStop && o.stopPrice) {
    ctx.addIssue({ code: 'custom', path: ['stopPrice'], message: 'Trigger price only applies to stop / take-profit orders' });
  }
  if (o.postOnly && o.type !== 'LIMIT') {
    ctx.addIssue({ code: 'custom', path: ['postOnly'], message: 'Post-only is only available for limit orders' });
  }
  if (o.timeInForce && !needsPrice) {
    ctx.addIssue({ code: 'custom', path: ['timeInForce'], message: 'Time in force only applies to limit orders' });
  }
  if (o.postOnly && o.timeInForce && o.timeInForce !== 'GTC' && o.timeInForce !== 'GTX') {
    ctx.addIssue({ code: 'custom', path: ['timeInForce'], message: 'Post-only orders must be GTC' });
  }
  const hasQty = Boolean(o.quantity);
  const hasQuote = Boolean(o.quoteQuantity);
  if (o.closePosition) return;
  if (o.type === 'MARKET' && o.side === 'BUY') {
    if (hasQty === hasQuote) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Provide either quantity or quoteQuantity' });
    }
  } else {
    if (!hasQty) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantity is required' });
    if (hasQuote) {
      ctx.addIssue({ code: 'custom', path: ['quoteQuantity'], message: 'quoteQuantity is only supported for market buys' });
    }
  }
}

export const spotOrderSchema = z
  .object({ ...baseOrder, quoteQuantity: positiveDecimal.optional() })
  .superRefine(refineOrderShape);

export const ocoOrderSchema = z.object({
  symbol: symbolSchema,
  side: z.enum(ORDER_SIDES),
  quantity: positiveDecimal,
  /** Limit-maker leg price (take profit). */
  price: positiveDecimal,
  /** Stop leg trigger price. */
  stopPrice: positiveDecimal,
  /** Stop leg limit price; omit for a stop-market leg. */
  stopLimitPrice: positiveDecimal.optional(),
  clientOrderId: clientOrderId.optional(),
});

export const amendOrderSchema = z
  .object({
    price: positiveDecimal.optional(),
    quantity: positiveDecimal.optional(),
  })
  .refine((v) => v.price || v.quantity, { message: 'Provide a new price and/or quantity', path: ['price'] });

export const cancelAllSchema = z.object({ symbol: symbolSchema.optional() });

export const futuresOrderSchema = z
  .object({
    ...baseOrder,
    reduceOnly: z.boolean().optional(),
    closePosition: z.boolean().optional(),
    /** Price source for trigger orders. */
    workingType: z.enum(['MARK_PRICE', 'LAST_PRICE']).optional(),
    takeProfitPrice: positiveDecimal.optional(),
    stopLossPrice: positiveDecimal.optional(),
  })
  .superRefine((o, ctx) => {
    refineOrderShape(o, ctx);
    if (o.type === 'MARKET' && o.side === 'BUY' && !o.quantity && !o.closePosition) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantity is required' });
    }
    if (o.closePosition && !isTriggerType(o.type)) {
      ctx.addIssue({ code: 'custom', path: ['closePosition'], message: 'closePosition requires a trigger order type' });
    }
    if (o.closePosition && o.quantity) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Do not send quantity with closePosition' });
    }
  });

export const leverageSchema = z.object({ symbol: symbolSchema, leverage: z.number().int().min(1).max(125) });
export const marginModeSchema = z.object({ symbol: symbolSchema, marginMode: z.enum(MARGIN_MODES) });
export const adjustMarginSchema = z.object({ amount: positiveDecimal, direction: z.enum(['ADD', 'REMOVE']) });
export const positionTpSlSchema = z
  .object({
    takeProfitPrice: positiveDecimal.optional().nullable(),
    stopLossPrice: positiveDecimal.optional().nullable(),
  })
  .refine((v) => v.takeProfitPrice !== undefined || v.stopLossPrice !== undefined, {
    message: 'Provide a take-profit and/or stop-loss price',
    path: ['takeProfitPrice'],
  });
export const closePositionSchema = z.object({ quantity: positiveDecimal.optional() });

export const optionsOrderSchema = z
  .object({
    symbol: symbolSchema,
    side: z.enum(ORDER_SIDES),
    type: z.enum(['LIMIT', 'MARKET']),
    price: positiveDecimal.optional(),
    quantity: positiveDecimal,
    timeInForce: z.enum(TIME_IN_FORCE).optional(),
    postOnly: z.boolean().optional(),
    reduceOnly: z.boolean().optional(),
    clientOrderId: clientOrderId.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.type === 'LIMIT' && !o.price) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Price is required' });
    if (o.type === 'MARKET' && o.price) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'Price is not allowed for market orders' });
    }
    if (o.postOnly && o.type !== 'LIMIT') {
      ctx.addIssue({ code: 'custom', path: ['postOnly'], message: 'Post-only requires a limit order' });
    }
  });

export const optionsChainQuery = z.object({
  underlying: z.string().regex(/^[A-Z0-9]{2,10}$/),
  expiry: z.coerce.number().int().positive(),
});

export const orderHistoryQuery = cursorQuery.extend({
  ...timeRangeQuery.shape,
  marketType: marketTypeSchema.optional(),
  symbol: symbolSchema.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  side: z.enum(ORDER_SIDES).optional(),
});

export const openOrdersQuery = z.object({
  marketType: marketTypeSchema.optional(),
  symbol: symbolSchema.optional(),
});

export const tradeHistoryQuery = cursorQuery.extend({
  ...timeRangeQuery.shape,
  marketType: marketTypeSchema.optional(),
  symbol: symbolSchema.optional(),
});

export const candlesQuery = z.object({
  interval: z.enum(CHART_TIMEFRAMES).default('1h'),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(1500).default(500),
});

export const orderBookQuery = z.object({
  depth: z.coerce.number().int().min(1).max(500).default(50),
  /** Aggregation step (multiple of tick size). */
  step: positiveDecimal.optional(),
});

export const publicTradesQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) });

export const marketListQuery = z.object({
  type: marketTypeSchema.optional(),
  underlying: z.string().regex(/^[A-Z0-9]{2,10}$/).optional(),
  status: z.string().optional(),
});

export type SpotOrderInput = z.infer<typeof spotOrderSchema>;
export type OcoOrderInput = z.infer<typeof ocoOrderSchema>;
export type AmendOrderInput = z.infer<typeof amendOrderSchema>;
export type FuturesOrderInput = z.infer<typeof futuresOrderSchema>;
export type OptionsOrderInput = z.infer<typeof optionsOrderSchema>;
export type CandlesQuery = z.infer<typeof candlesQuery>;
export type OrderHistoryQuery = z.infer<typeof orderHistoryQuery>;
