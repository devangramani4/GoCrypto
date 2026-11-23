# Performance, load testing and capacity

This document records how GoCrypto was load tested, the bugs and bottlenecks that testing exposed (all
fixed), the capacity measured per service instance, and what it takes to serve **5 million concurrent
users**. The load generator lives in [`tools/loadtest`](../tools/loadtest/README.md).

> All tests ran in **sandbox / paper-trading mode** with seeded test accounts. Nothing here assumes real
> funds; see the regulatory note in [DEPLOYMENT.md](DEPLOYMENT.md#going-live-real-funds).

## 1. Test environment and method

| Item       | Setup                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardware   | **One 4 vCPU VM** (Xeon 2.3 GHz, 16 GB). Every service, MariaDB 10.11, Redis 7 _and_ the load generators share it, over loopback.                                                                          |
| Stack      | Production bundles (`pnpm build:backend`), `NODE_ENV=production`, `APP_ENV=staging`, `TRUST_PROXY=true`, sandbox market data + market maker, `LOG_LEVEL=warn`.                                             |
| MariaDB    | `innodb_buffer_pool_size=2G`, `innodb_flush_log_at_trx_commit=1` (durable commits), `READ-COMMITTED`, `max_connections=600`.                                                                               |
| Data       | 20,000 seeded users (funded spot + futures accounts, sessions minted directly), ~600 markets (8 actively traded), tables grown to ~0.5 M orders / 1.4 M ledger rows during the runs.                       |
| Generators | `tools/loadtest` (Socket.IO wire protocol over raw WebSockets, undici HTTP pool); each virtual user presents its own client IP via `X-Forwarded-For` so per-user and per-IP limits behave like production. |

**Standard mixed scenario** (60 s, 20 s ramp): 2,000 WebSocket viewers (30% authenticated; every viewer
watches a market's ticker and trades, 25% also the order book, 20% also all tickers), 200 market-data
readers, 200 account readers, 200 traders (spot and futures limit orders, 30% marketable, 80% cancelled
after ~3 s) and 2 password logins/s. Symbols follow a Zipf-like popularity (BTC and ETH dominate).

**Caveats.** Because everything shares 4 vCPUs, the box runs at 85–90% CPU in the mixed scenario (run queue
up to 19). Latency percentiles therefore swing ±30–50% between identical runs; compare throughput, error
counts and CPU per operation first. Loopback networking also charges the receive side of every socket write
to the same CPUs, so per-node network numbers here are conservative.

## 2. Results

### Mixed scenario: first run vs. final

| Operation                | Baseline (first run)                    | Final (3 engine shards)                       | Change                                                         |
| ------------------------ | --------------------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Spot order placement     | 93.5/s, p50 439 ms, p95 3,032 ms        | 136.3/s, p50 70 ms, p95 550 ms                | +46% throughput, −82% p95                                      |
| Futures order placement  | 23.0/s, p95 1,644 ms                    | 32.7/s, p95 336 ms                            | +42% throughput, −80% p95                                      |
| Cancel                   | 52.6/s, p95 3,010 ms                    | 90.4/s, p95 428 ms                            | +72% throughput, −86% p95                                      |
| Failed requests          | **1,109** (270 HTTP 500 from deadlocks) | **0** (only legitimate 422 cancel/fill races) |                                                                |
| Engine time per NEW      | 17.4 ms                                 | 8–10 ms                                       |                                                                |
| Portfolio summary        | p95 140 ms                              | p95 137 ms (at +46% trading load)             | ~22 sequential → ~9 concurrent queries                         |
| WebSocket delivery lag   | p95 66 ms                               | p95 66–100 ms                                 | ~equal, fewer frames sent                                      |
| Order book / ticker REST | p95 30–35 ms                            | p95 70–80 ms                                  | CPU contention from the extra trading load on the same 4 vCPUs |

Traders are closed-loop (each waits for its response), so lower latency shows up as higher throughput.

### WebSocket gateway at 10,000 connections (one gateway process)

10,000 viewers ramped over 40 s, plus 100 traders and 100 HTTP users, on the same 4 vCPUs:

| Version                                           | Connected   | Failed                                                  | Lag p50 / p95 / p99      | Worst event-loop stall | Gateway RSS |
| ------------------------------------------------- | ----------- | ------------------------------------------------------- | ------------------------ | ---------------------- | ----------- |
| Before (one generator process)                    | 7,030       | 5,940 (25 k kernel accept-queue drops)                  | 571 / 3,233 / 3,400 ms   | not measured           | —           |
| + accept backlog, coalesced trades (2 generators) | 7,777–8,075 | 1,925–2,220 (handshakes timed out)                      | 2,612 / 5,611 / 5,844 ms | 19.6 s                 | 784–812 MB  |
| + time-sliced, coalescing fan-out                 | 10,000      | 0, but connects took up to 37 s                         | 171 / 444 / 537 ms       | 0.15 s                 | 442 MB      |
| + CPU-based admission control (final)             | 9,552       | 448 refused at once (HTTP 403; clients retry elsewhere) | 150 / 358 / 418 ms       | 0.15 s                 | 727 MB      |

The first row's lag is understated: its single generator process was itself saturated. With 5,000
connections the gateway delivers ~39,000 frames/s at p95 lag 154 ms with no errors.

### Other measurements

| Measurement                           | Result                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| API CPU per HTTP request (mixed)      | 1.60 ms → **1.42 ms** after removing per-query stack capture and repeated JWT WebCrypto verification  |
| Password login (Argon2id 19 MiB, t=2) | ~14.5 ms CPU each; **60 logins/s per API process** at p95 44 ms (20/s: p95 35 ms)                     |
| MariaDB round trip / durable commit   | 0.08 ms / 0.22–0.36 ms; only 4 statements slower than 15 ms in 30 s of peak load                      |
| SQL per matching order                | 33 → 30 statements (16 for an order that only rests)                                                  |
| WebSocket frames for 2,000 viewers    | 23.4 k/s → 15.4 k/s (−34%) at the same fill rate (public trades coalesced per market per 100 ms tick) |

## 3. Bugs and bottlenecks found and fixed

Correctness and reliability:

1. **Settlement deadlocks** — an `INSERT IGNORE INTO wallets` inside settlement took shared locks on hot system
   wallets and deadlocked with `FOR UPDATE` locks: 270 orders/minute failed with HTTP 500. Wallet rows are now
   created by a cached, lock-free existence check before the transaction. Result: zero deadlocks.
2. **Executed orders reported as failed** — a Redis error _after_ the settlement commit was handled as a
   settlement failure (client got 500 for an order that had executed, and the book was reloaded). Post-commit
   publishing is now isolated from the settlement result.
3. **Recent-trades order** — multi-fill matches were stored oldest-first in the newest-first recent-trades
   list, so `GET /markets/{symbol}/trades` showed those trades out of order.
4. **Market-maker ladder sizing (sandbox)** — USD notional was used as quote units, so ETH/BTC levels were
   3,000 BTC each (5,522 BTC locked). Converted through the quote asset's USD price.
5. **Unbounded in-memory caches** (user flags, notification preferences, API keys, fee overrides) grew with
   every user ever seen — a memory leak at millions of users. All are bounded TTL/LRU caches now.
6. **WebSocket overload collapse** — under load the gateway's accept queue overflowed, then a backlog of
   order-book snapshots was fanned out synchronously, blocking the event loop for up to 19.6 s (handshakes and
   pings timed out, memory grew). Fixed by a deeper accept backlog, time-sliced fan-out with snapshot
   coalescing, CPU-based admission control (`/ready`) and slow-consumer eviction.
7. **Rate limiting by IP only** — every user behind one NAT, mobile carrier gateway or corporate proxy shared a
   bucket. Authenticated requests are now limited per verified user, API keys per key + IP.
8. **PM2 websocket instances** ran in fork mode, so more than one instance would fail to bind the port; the
   gateway now runs in cluster mode.

Throughput and scalability:

9. **Hot wallet rows** — the fee collector's wallet was locked by every trade, and one market-maker account by
   every fill: 145 of 146 sampled lock waits. Fees are now appended to `fee_accruals` and swept every second;
   each sandbox book quotes from its own sub-account; spot settlement locks wallets last; all touched wallets
   are updated in one statement. Lock waiting fell from 103 s to 18.5 s per minute of load.
10. **Single matching-engine process** — every market shared one event loop and one stream. Markets are now
    sharded across engine processes (`ENGINE_SHARDS`, pins for hot books), each with its own command stream and
    leader election.
11. **Head-of-line blocking in the command consumer** — the engine processed stream batches with a barrier, so
    one slow market stalled all others. Commands are now pipelined (per-market order preserved, per-message ack).
12. **WebSocket fan-out to every node** — each gateway received every channel's traffic. Nodes now subscribe to
    Redis channels only for rooms they host (all private channels of a user share one Redis channel), there are
    no per-socket timers, and session revocation is O(sockets of that user).
13. **Uncoalesced public trades** — one WebSocket frame per match per subscriber; at exchange trade rates each
    viewer would receive hundreds of frames per second. Now one frame per market per publish tick.
14. **Redundant API work** — public endpoints are served from single-flight micro-caches with pre-serialised
    JSON; access tokens are verified once and cached until expiry (revocation is still checked on every
    request); mysql2's per-query stack capture is off by default (`DATABASE_TRACE`).
15. **Portfolio summary** ran ~22 sequential queries per request; related aggregates are now folded into single
    statements and the remaining ~9 queries run concurrently (p95 under load 496 → 137 ms).
16. Ticker publishing read books one key at a time and re-broadcast all tickers each second; now one `MGET` and
    deltas only.

## 4. Capacity per instance (measured, conservative)

| Unit                               | Measured on the test VM                                               | Planning figure (≈65% CPU)                          |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| WebSocket gateway process (1 core) | ~9,500 clients, ~37 k frames/s, p95 lag < 400 ms at saturation        | **6,000 clients** at ~5 frames/s each               |
| API process (1 core)               | 1.42 ms CPU per mixed request (≈700 req/s at 100%)                    | **450 req/s** (public cached endpoints are cheaper) |
| Password logins                    | 60/s per process at p95 44 ms                                         | **40/s** per process                                |
| Matching: one order book           | 8–10 ms per command including the settlement transaction (≈100–125/s) | **80 commands/s per book**                          |
| Matching: one engine shard process | ~30% of a core at roughly 200 commands/s across its books             | ~500 commands/s per shard (book limit applies)      |
| MariaDB (per core of the primary)  | ~13–15 k statements/s per core in the mixed load                      | size by statements/s and fsyncs/s (below)           |

## 5. Sizing for 5 million concurrent users

Assumed peak workload (adjust to real telemetry):

| Driver    | Assumption                                                                                     | Peak load                         |
| --------- | ---------------------------------------------------------------------------------------------- | --------------------------------- |
| WebSocket | 5 M connections, ~5 frames/s each (one market on screen + private events)                      | ~25 M frames/s fan-out            |
| HTTP      | one request per user every 20 s; ~60% public market data (cacheable at the edge)               | 250 k req/s, ~100 k reach the API |
| Orders    | 1% of users act per minute, ×10 peak factor, placements ≈ cancels (API trading comes on top)   | ~16 k engine commands/s           |
| Logins    | steady 300/s; 1–2 k/s for a few minutes after an outage (refresh tokens cover most reconnects) | 2 k/s                             |

What the current architecture needs:

| Tier               | Sizing                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge               | L4 load balancers + CDN for static assets and public REST (responses already carry `Cache-Control` of 0.25–10 s). Kernel tuning in §7.                                                                                                                         |
| WebSocket gateways | 5 M ÷ 6 k ≈ **850 gateway processes** (one per vCPU), e.g. 30 × 32-vCPU nodes, readiness on `/ready`. Fewer with the reductions in §6.                                                                                                                         |
| Redis fan-out      | Each hot channel is delivered once per gateway process (~850×): a few hundred thousand messages/s in total → Redis Cluster with sharded pub/sub, or a relay tier (each relay feeding ~40 gateways). Keep engine streams and rate limits on separate instances. |
| API                | ~100 k req/s ÷ 450 ≈ **220 processes**, plus ~50 for a 2 k/s login storm.                                                                                                                                                                                      |
| Matching engine    | The long tail of markets spreads over shards (e.g. 16). **The hot books do not fit:** with Zipf-distributed activity BTCUSDT alone would see ~4–5 k commands/s, ~50× the 80/s a book sustains with one settlement transaction per command.                     |
| Database           | ~16 k commands/s × ~30 statements ≈ 480 k statements/s and ~16 k durable commits/s on one primary — beyond a single MariaDB primary.                                                                                                                           |

**Conclusion.** The edge tier (WebSocket gateways, API, caches) now scales horizontally and degrades gracefully
under overload; 5 M concurrent connections is a matter of fleet size. The trading core is the limit: one
database transaction per command caps each order book at roughly 80–125 commands/s on this hardware (faster
storage and dedicated hosts raise that perhaps 2–4×, not 50×). Reaching exchange-scale order rates needs the
next architectural step below. Until then, the platform as built supports on the order of hundreds of
thousands of concurrent users with typical retail trading activity, and millions of market-data viewers.

## 6. Roadmap to exchange-scale throughput

1. **Batched settlement per book (group commit).** Match a book's queued commands in memory, then persist the
   whole batch in one transaction with multi-row statements; fall back to per-command settlement when a batch
   fails. Expected ~5–10× fewer statements and fsyncs per command and ~10× per-book throughput.
2. **In-memory balance and risk engine.** Single-writer account shards holding balances and margin in memory,
   with an append-only journal (event sourcing) persisted asynchronously and idempotently to MariaDB — the model
   production exchanges use for 10–100 k orders/s per book.
3. **Data partitioning.** Partition `orders`, `order_fills`, `trades` and `wallet_transactions` by time and/or
   user; serve history and analytics from replicas; maintain portfolio aggregates (realized PnL, net deposits)
   incrementally instead of summing history.
4. **Cheaper market data.** Incremental depth updates with sequence numbers instead of 100-level snapshots
   (≈10× fewer bytes), a configurable publish interval (`ENGINE_PUBLISH_INTERVAL_MS`; 250 ms instead of 100 ms
   roughly halves depth and trade frames), per-client batching, or a compiled WebSocket server (uWebSockets.js)
   for several times more frames per core.
5. **Redis topology.** Separate clusters for engine streams, fan-out (sharded pub/sub) and cache/rate limits.

## 7. Operating at scale

Configuration added in this round (see `.env.example`):

| Variable                         | Default | Purpose                                                                              |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `ENGINE_SHARDS` / `ENGINE_SHARD` | 1 / 0   | Number of engine shards; shard served by this engine instance                        |
| `ENGINE_SHARD_PINS`              | —       | Pin busy books to shards, e.g. `BTCUSDT=0,ETHUSDT=1`                                 |
| `ENGINE_PUBLISH_INTERVAL_MS`     | 100     | Depth snapshot and public-trade publish tick per market                              |
| `WS_MAX_CONNECTIONS`             | 20000   | Connections per gateway process before it refuses new ones                           |
| `WS_SHED_CPU`                    | 0.9     | Refuse new connections after 3 s above this many cores (admit again after 5 s below) |
| `WS_SHED_LOOP_DELAY_MS`          | 250     | …or after 3 s with event-loop delay p99 above this                                   |
| `WS_SLOW_CONSUMER_BYTES`         | 8 MiB   | Disconnect clients with more than this queued                                        |
| `DATABASE_TRACE`                 | false   | mysql2 per-query stack capture (debugging only, ~5% CPU)                             |

Host tuning for gateway and edge nodes:

```bash
sysctl -w net.core.somaxconn=65535 net.ipv4.tcp_max_syn_backlog=65535
sysctl -w net.ipv4.ip_local_port_range="10000 65535" fs.file-max=4000000
# per process: LimitNOFILE=1048576 (systemd) / ulimit -n; nginx: worker_rlimit_nofile, worker_connections
```

- One gateway process per vCPU (PM2 cluster mode, or one container per vCPU); `/health` for liveness,
  `/ready` for readiness. Never restart a gateway because it is busy — that causes a reconnect storm.
- Redis used for fan-out: raise `client-output-buffer-limit pubsub` (e.g. `256mb 64mb 60`) so a briefly slow
  gateway is not disconnected; watch `gocrypto_ws_coalesced_total` (a lagging node coalesces snapshots).
- Engine shards: put each shard (and its standby) on its own core; give shards that share a host distinct
  `METRICS_PORT`s; drain the engines before changing `ENGINE_SHARDS` or pins.
- Alert on engine queue depth (`gocrypto_engine_queue_depth`), settlement failures, WebSocket admission
  refusals and event-loop delay.

## 8. Reproducing and scaling the tests

See [`tools/loadtest/README.md`](../tools/loadtest/README.md). A single generator process sustains about
5,000 WebSocket clients plus a few hundred HTTP users; run several per machine (`--userOffset` slices the
seeded users) and many machines for multi-million-connection tests. Each source IP can hold ~64 k connections
to one destination address and port, so spread generators over several source IPs or load-balancer addresses.

Not covered by these single-VM runs: real network and TLS termination, multi-host Redis/MariaDB, failover under
load, and multi-hour soak tests for slow leaks. Run those on a staging environment sized like production
before launch.
