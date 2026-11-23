import type { Timeframe } from './timeframes';
import type {
  BalanceDto,
  CandleDto,
  FillDto,
  FuturesPositionDto,
  LiquidationDto,
  MarkPriceDto,
  NotificationDto,
  OptionPositionDto,
  OrderBookDto,
  OrderDto,
  PublicTradeDto,
  TickerDto,
} from './dto';

/**
 * WebSocket (Socket.IO) contract.
 *
 * Client -> server:
 *   emit('subscribe',   { channels: string[] }, ack)   ack: { ok: string[]; denied: string[] }
 *   emit('unsubscribe', { channels: string[] }, ack)
 *
 * Server -> client:
 *   emit('event', WsEnvelope)
 *
 * Private `user:{id}:*` channels are joined automatically for the authenticated socket and can
 * never be subscribed to for another user id.
 */

export type MarketChannelKind = 'ticker' | 'orderbook' | 'trades' | 'mark' | 'liquidations' | `candles:${Timeframe}`;
export type UserChannelKind = 'orders' | 'trades' | 'positions' | 'balance' | 'notifications' | 'liquidations';

export const ALL_TICKERS_CHANNEL = 'market:all:tickers';

export function marketChannel(symbol: string, kind: MarketChannelKind): string {
  return `market:${symbol}:${kind}`;
}

export function userChannel(userId: string, kind: UserChannelKind): string {
  return `user:${userId}:${kind}`;
}

export const USER_CHANNEL_KINDS: readonly UserChannelKind[] = [
  'orders',
  'trades',
  'positions',
  'balance',
  'notifications',
  'liquidations',
];

export interface ParsedChannel {
  scope: 'market' | 'user';
  id: string;
  kind: string;
}

export function parseChannel(channel: string): ParsedChannel | null {
  const m = /^(market|user):([A-Za-z0-9_\-.]+):([a-z]+(?::[0-9a-zA-Z]+)?)$/.exec(channel);
  if (!m) return null;
  return { scope: m[1] as 'market' | 'user', id: m[2]!, kind: m[3]! };
}

export interface WsPositionEvent {
  marketType: 'FUTURES' | 'OPTIONS';
  /** Null quantity/position means the position was closed. */
  futures?: FuturesPositionDto | null;
  options?: OptionPositionDto | null;
  symbol: string;
}

export interface WsCandleEvent {
  symbol: string;
  interval: Timeframe;
  candle: CandleDto;
}

/** Maps a channel kind to its payload type. */
export interface WsPayloads {
  ticker: TickerDto;
  tickers: TickerDto[];
  orderbook: OrderBookDto;
  trades: PublicTradeDto[];
  mark: MarkPriceDto;
  candle: WsCandleEvent;
  liquidation: LiquidationDto;
  order: OrderDto;
  fill: FillDto;
  position: WsPositionEvent;
  balance: BalanceDto[];
  notification: NotificationDto;
}

export type WsEventType = keyof WsPayloads;

export interface WsEnvelope<T extends WsEventType = WsEventType> {
  channel: string;
  type: T;
  data: WsPayloads[T];
  ts: number;
}

export interface WsSubscribeAck {
  ok: string[];
  denied: string[];
}
