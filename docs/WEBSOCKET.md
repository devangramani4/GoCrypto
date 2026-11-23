# WebSocket API

Real-time data is served by `services/websocket` over Socket.IO (websocket transport) at
`wss://<host>/socket.io`. The typed contract lives in `packages/shared-types/src/ws.ts`, and
`packages/api-client` ships a reference client (`RealtimeClient`) with reference-counted subscriptions
and automatic re-subscription after reconnects.

## Connecting

```ts
import { io } from 'socket.io-client';

const socket = io('https://gocrypto.example', {
  path: '/socket.io',
  transports: ['websocket'],
  auth: { token: accessToken }, // optional: omit for public market data only
});
```

- With a valid access token the server joins the socket to **all** of that user's private channels.
  Private channels can never be subscribed to explicitly, and never for another user id.
- After refreshing the access token, send it without reconnecting:
  `socket.emit('auth', { token }, (r) => r.ok)`.
- Server-initiated events: `auth_expired` (refresh and re-send the token) and `session_revoked`
  (the session was logged out or revoked — clear credentials).

## Subscribing to market data

```ts
socket.emit('subscribe', { channels: ['market:BTCUSDT:orderbook', 'market:BTCUSDT:trades'] }, (ack) => {
  // ack: { ok: string[]; denied: string[] }
});
socket.emit('unsubscribe', { channels: ['market:BTCUSDT:trades'] });
socket.on('event', (env) => {
  // env: { channel, type, data, ts }
});
```

| Channel                        | `type`        | Payload                                                                                              |
| ------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------- |
| `market:all:tickers`           | `tickers`     | `TickerDto[]` (batched, all markets)                                                                 |
| `market:{symbol}:ticker`       | `ticker`      | `TickerDto`                                                                                          |
| `market:{symbol}:orderbook`    | `orderbook`   | `OrderBookDto` snapshot (coalesced, monotonically increasing `seq`)                                  |
| `market:{symbol}:trades`       | `trades`      | `PublicTradeDto[]`                                                                                   |
| `market:{symbol}:mark`         | `mark`        | `MarkPriceDto` (mark, index, funding rate, next funding time)                                        |
| `market:{symbol}:candles:{tf}` | `candle`      | `{ symbol, interval, candle }` — forming candle updates; `tf` ∈ `1m 3m 5m 15m 30m 1h 2h 4h 1d 1w 1M` |
| `market:{symbol}:liquidations` | `liquidation` | Public liquidation prints                                                                            |

## Private channels (joined automatically)

| Channel                   | `type`         | Payload                                                        |
| ------------------------- | -------------- | -------------------------------------------------------------- |
| `user:{id}:orders`        | `order`        | `OrderDto` on every state change                               |
| `user:{id}:trades`        | `fill`         | `FillDto` for each execution                                   |
| `user:{id}:balance`       | `balance`      | `BalanceDto[]` changed balances                                |
| `user:{id}:positions`     | `position`     | `{ marketType, symbol, futures?, options? }` (`null` = closed) |
| `user:{id}:notifications` | `notification` | `NotificationDto`                                              |
| `user:{id}:liquidations`  | `liquidation`  | `LiquidationDto`                                               |

## Guarantees and limits

- Order book messages are full snapshots of the top levels (coalesced per publish interval), so a client
  never needs to replay deltas; use REST `GET /markets/{symbol}/orderbook` for the initial state.
- `trades` messages carry every execution of the market since the previous message, oldest first (one
  message per market per publish interval, 100 ms by default).
- When a gateway node is behind, it sends the **latest** order book / ticker / mark snapshot instead of every
  intermediate one, merges pending trade batches (keeping the latest 200 trades) and `tickers` deltas. Private
  events (`order`, `fill`, `balance`, `position`, `notification`) and candles are never dropped or merged.
- A node that is full or saturated refuses new connections (the handshake fails with HTTP 403 `server busy`);
  clients should reconnect with randomized exponential backoff — the reference client and `socket.io-client`
  defaults do — and the load balancer routes them to another node. Clients that stop reading (more than
  `WS_SLOW_CONSUMER_BYTES`, 8 MiB by default, queued) are disconnected and resync on reconnect.
- Events are delivered at-most-once per connection; after a reconnect, refetch REST state (the reference
  client re-subscribes automatically, and the web app invalidates its caches).
- Each socket may hold at most 200 channel subscriptions and perform 20 subscribe/unsubscribe operations
  per second (excess requests are acknowledged with `denied`); channels are validated against existing markets.
