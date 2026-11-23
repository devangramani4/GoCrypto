# Architecture

GoCrypto is an exchange-style platform for spot, USDT-margined perpetual futures and options trading.
All business logic lives in backend services; the web, desktop, mobile and admin clients only render
state and submit requests through the versioned REST API and the WebSocket gateway.

```
            ┌──────────── clients ────────────┐
            │ web (React) · desktop (Electron)│
            │ mobile (React Native) · admin   │
            └──────┬───────────────────┬──────┘
           HTTPS /api/v1          WSS /socket.io
                   │                   │
            ┌──────▼──────┐     ┌──────▼──────┐
            │  nginx edge │────▶│  websocket  │◀── Redis pub/sub (gc:ws:*)
            └──────┬──────┘     └─────────────┘
                   │
            ┌──────▼──────┐  admission (risk checks, reservations in a DB transaction)
            │     api     │──────────────────────────────┐
            └──────┬──────┘                              │
        Redis stream: engine commands                    │
            ┌──────▼──────────┐   settlement (one DB txn per command)
            │ matching-engine │──────────────────────────┤
            └──────┬──────────┘                          │
   trade/mark events (Redis streams + pub/sub)        ┌──▼───────────┐
            ┌──────▼──────┐  ┌─────────────┐          │ MariaDB      │
            │ risk-engine │  │ market-data │          │ (source of   │
            │ liquidation │  │ index/mark, │          │  truth)      │
            └─────────────┘  │ candles, MM │          └──────────────┘
            ┌─────────────┐  └─────────────┘
            │   workers   │  triggers (stop/TP), funding, options expiry,
            └─────────────┘  deposits/withdrawals, notifications (BullMQ)
```

## Services

| Service                    | Responsibility                                                                                                                                                                                | Scaling                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api`             | Fastify REST API (`/api/v1`), auth, validation (zod), order admission via the risk engine library, wallet operations, admin.                                                                  | Stateless, horizontal.                                                                                                                  |
| `services/websocket`       | Socket.IO gateway. Public market channels and private `user:{id}:*` channels joined server-side from the access token. Targeted fan-out from Redis, coalescing under load, admission control. | Stateless, horizontal (websocket transport only, no sticky sessions); one process per core.                                             |
| `services/matching-engine` | In-memory order books with price-time priority; executes commands from per-shard Redis streams; atomic settlement; publishes trades, depth and order updates.                                 | Sharded by market (`ENGINE_SHARDS`); one leader per shard (Redis leader election) plus hot standbys. Markets run on independent chains. |
| `services/risk-engine`     | Event-driven liquidation engine (evaluates accounts on mark-price ticks), insurance fund takeover/unwind, ADL safety.                                                                         | Leader election, standby.                                                                                                               |
| `services/market-data`     | Index prices (simulated GBM feed in sandbox or external exchange streams), mark price, funding prediction, 24h tickers, candles, sandbox market maker.                                        | Leader election, standby.                                                                                                               |
| `services/workers`         | Trigger orders (stop / take-profit), funding settlement, options listing & expiry settlement, deposit confirmations, withdrawal processing, notifications (email / SMS / push), maintenance.  | Horizontal (BullMQ).                                                                                                                    |

Shared packages:

- `packages/shared-types` — DTOs, enums, permissions, WebSocket contract, error codes.
- `packages/trading-utils` — decimal math (decimal.js), filters, futures/options math (liquidation price, Black–Scholes, Greeks), indicators, formatting. Used by backend _and_ clients so previews match the server.
- `packages/validation` — zod schemas shared by the API and the clients.
- `packages/server-core` — configuration, MariaDB access (transactions, row locks, deadlock retry), Redis, queues, metrics and all domain services.
- `packages/api-client` — typed REST client (token refresh, idempotency keys) and Socket.IO realtime client.
- `packages/ui` — web design system (dark-first tokens, primitives, tables, modals).

## Money and precision

- Every amount is a `DECIMAL(36,18)` in MariaDB and a **string** everywhere else (API, WebSocket, clients).
- Arithmetic uses `decimal.js` through `@gocrypto/trading-utils` (`D()`, `q18`, `floorToStep`, …). JavaScript
  floating point is never used for balances, prices, margin or fees. (Charts convert to numbers for drawing only.)
- Balances have database `CHECK` constraints (`available >= 0`, `locked >= 0`): an over-spend aborts the transaction.

## Order lifecycle

1. **Client** sends `POST /api/v1/{spot|futures|options}/orders` with an `Idempotency-Key`.
2. **Admission** (`services/risk-engine/src/admission.ts`, executed in the API process):
   authentication → account status → market status → exchange filters (tick/step/min/max/notional)
   → risk limits (leverage tiers, max position, price band) → **reservation** of funds or margin inside a
   DB transaction with `SELECT … FOR UPDATE` → order row inserted (`NEW`) → command dispatched.
   Reservation prices come from the engine's book snapshot or the mark price — never from the client.
3. **Matching engine** pulls the command from the market's serialized chain, matches with price-time
   priority (STP: expire maker; IOC/FOK/GTX post-only; quote-budget market buys; price protection band).
4. **Settlement** persists the whole command in **one transaction**: trades (unique `(market_id, seq)`),
   fills, order states, ledger entries, wallet balances, positions, fees and realized PnL. Trading fees are
   appended to `fee_accruals` in the same transaction and swept into the fee collector's wallet every second
   by the workers (one ledger entry per asset and batch), so that hot wallet is never part of a trade's lock set.
   A failure rolls everything back and the runner rebuilds the in-memory book from the database.
5. **Events** (`order`, `fill`, `trade`, `orderbook`, `balance`, `position`) are published after commit and
   fanned out by the WebSocket gateway. Public trades and depth snapshots are coalesced per market and
   published once per tick (`ENGINE_PUBLISH_INTERVAL_MS`, 100 ms), so subscriber traffic stays bounded
   however busy a market gets. Publishing problems after the commit never turn an executed order into an error.

Statuses: `NEW → OPEN → PARTIALLY_FILLED → FILLED`, or `CANCELLED`, `REJECTED`, `EXPIRED`.
Trigger orders (stop / take-profit) stay `NEW` with `triggerState=PENDING` until the trigger worker fires them.

## Concurrency and consistency

- **Lock order** is always `orders → wallets → positions`; derivatives position changes also take the
  settle-asset wallet row lock (the wallet acts as the per-account mutex). Deadlocks are retried. Spot
  settlement writes trades, fills and orders first and locks wallets last, and all touched wallets are updated
  in one statement, so shared rows stay locked for the shortest possible time. Missing wallet rows are created
  with a lock-free existence check (cached) before the transaction instead of `INSERT IGNORE` inside it.
- **Market making (sandbox)**: each book quotes from its own system sub-account funded by ledger transfers, so
  fills on one market never queue behind another market's settlement on a shared wallet row.
- **Idempotency**: `Idempotency-Key` on order placement (cached response), unique `client_order_id`, unique
  idempotency keys for withdrawals and transfers, unique trade sequence per market.
- **Liquidation** is protected against double execution by four layers: in-process in-flight set, Redis lock
  per user, re-check under row locks inside the transaction, and a `UNIQUE (position_id, position_version)`.
- **Engine recovery**: on start the engine rebuilds books from open orders and re-submits orders that were
  admitted but not processed; an orphan sweeper reconciles stale reservations.
- The database is the **source of truth**; Redis carries commands, events, caches, locks and rate limits.

## Derivatives

- **Perpetuals**: USDT-margined, cross or isolated margin, leverage up to the tier limit, tiered maintenance
  margin (risk-limit brackets), mark price = median(index-based, impact-price, last) clamp, funding every 8h
  from a premium-index TWAP (capped), reduce-only, post-only, attached TP/SL (close-position trigger orders).
- **Liquidation**: when margin ratio ≥ 100% the position is taken over at the bankruptcy price into the
  insurance fund account and unwound; any deficit is covered by the insurance fund.
- **Options**: European, cash-settled in USDT at 08:00 UTC expiry; chain with Black–Scholes mark/IV/Greeks;
  short positions are margined (`max(15% S − OTM, 10% S|K) + mark`); expiry settlement credits intrinsic value.

## Data flows without per-user timers

Prices, tickers, depth and candles are produced once per market and fanned out through Redis channels.
The liquidation engine evaluates only accounts affected by a mark-price change. Background work runs on
BullMQ queues; scheduled jobs use repeatable jobs with leader election.

The WebSocket gateway subscribes to a Redis channel only while it hosts a room that needs it (all private
channels of a user share one Redis channel), so adding gateway nodes does not multiply the traffic each node
receives. Updates are queued per channel and fanned out in time slices: when a node falls behind, a newer
order-book / ticker / mark snapshot replaces the pending one and trade batches merge, so a lagging node sends
fewer, fresher frames instead of stalling. Nodes refuse new connections while full or CPU-saturated (`/ready`
answers 503 so the load balancer routes elsewhere) and disconnect clients that stop reading.

## Scaling and capacity

Load-test results, the bottlenecks found and fixed, measured per-instance capacity and the sizing plan for
millions of concurrent users are in [PERFORMANCE.md](PERFORMANCE.md); the load generator is in
`tools/loadtest`.

## Clients

- **Web** (`apps/web`): React 19 + Vite, TanStack Query, TradingView-style charts (lightweight-charts) with
  indicators and drawings, live order book, resizable pro layout. Access token in memory; refresh token in an
  httpOnly `SameSite=Strict` cookie (CSRF-protected by the custom `X-GC-Client` header).
- **Desktop** (`apps/desktop`): Electron shell around the web build with a sandboxed preload bridge and
  OS-keychain token storage.
- **Mobile** (`apps/mobile`): React Native (Expo) app with bottom tabs, secure token storage, biometrics and push.
- **Admin** (`apps/admin`): role/permission-aware back office over `/api/v1/admin`.
