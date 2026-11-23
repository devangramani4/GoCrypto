# @gocrypto/loadtest

Load-test toolkit for a **sandbox / staging** GoCrypto deployment: a user seeder and a mixed-scenario load
generator. Results and the capacity plan are in [docs/PERFORMANCE.md](../../docs/PERFORMANCE.md).

> **Never run this against production or real funds.** The seeder writes users, balances and sessions
> directly to the database and refuses to run when `APP_ENV=production` or `TRADING_MODE` is not `SANDBOX`. The users file it writes contains
> **live access and refresh tokens**: keep it out of the repository (`tools/loadtest/users*.json` and
> `tools/loadtest/results/` are git-ignored), and delete it — or revoke the sessions — when you are done.

## 1. Seed users

Run with the same environment (`DATABASE_URL`, `REDIS_URL`, JWT secrets …) as the target stack:

```bash
pnpm --filter @gocrypto/loadtest seed -- --users 20000 --out users.json
```

| Option       | Default              | Meaning                                                                 |
| ------------ | -------------------- | ----------------------------------------------------------------------- |
| `--users`    | 1000                 | Number of users to create                                               |
| `--out`      | `users.json`         | Output file (`{ password, users: [{ id, email, accessToken, … }] }`)    |
| `--password` | `LoadTest-Passw0rd!` | Password of every seeded user (used by the login storm)                 |
| `--prefix`   | `lt<timestamp>`      | E-mail prefix (`<prefix>+<n>@loadtest.gocrypto`)                        |
| `--batch`    | 200                  | Users per database transaction                                          |
| `--topup`    | —                    | Instead of seeding, credit base assets to the users of an existing file |

Each user gets 1,000,000 USDT spot, 500,000 USDT futures and ~$200,000 of every spot base asset, credited
through the wallet service so the ledger still reconciles. Sessions are minted the way the auth service does
(session row + token pair), so thousands of virtual users start without running thousands of Argon2 checks.
Access tokens expire after `JWT_ACCESS_TTL_SEC`: raise it for long runs, or reseed.

## 2. Run a scenario

```bash
pnpm --filter @gocrypto/loadtest run -- --users users.json --duration 60 --ramp 20 \
  --viewers 2000 --readers 200 --accounts 200 --traders 200 --logins 2 --out results/run.json
```

Run the API with `TRUST_PROXY=true`: every virtual user sends its own client IP in `X-Forwarded-For`, like
traffic arriving through the edge proxy, so per-IP and per-user rate limits behave as in production.

| Option                                               | Default                           | Meaning                                                                                                 |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--api` / `--ws`                                     | `http://127.0.0.1:4000` / `:4001` | API and WebSocket gateway base URLs                                                                     |
| `--duration`                                         | 60                                | Seconds, including the ramp                                                                             |
| `--ramp`                                             | 20                                | Seconds over which virtual users start                                                                  |
| `--viewers`                                          | 1000                              | WebSocket viewers (30% authenticated; ticker + trades, 25% order book, 20% all tickers)                 |
| `--readers`                                          | 100                               | HTTP market-data users (tickers, order book, trades, candles)                                           |
| `--accounts`                                         | 100                               | HTTP account users (balances, open orders, positions, portfolio)                                        |
| `--traders`                                          | 100                               | Place spot/futures limit orders around the mid (30% marketable), cancel ~80% of resting ones after ~3 s |
| `--logins`                                           | 0                                 | Password logins per second (Argon2 path)                                                                |
| `--readerThink` / `--accountThink` / `--traderThink` | 1000 / 2000 / 1000                | Think time between a virtual user's requests (ms, ±50% jitter)                                          |
| `--symbols`                                          | 5 spot + 3 perpetuals             | Markets to use (popularity is Zipf-like, the first symbols dominate)                                    |
| `--userOffset`                                       | 0                                 | First user of the file to use (give each generator process its own slice)                               |
| `--connections`                                      | 512                               | HTTP connection pool size                                                                               |
| `--out`                                              | —                                 | Write the JSON report here                                                                              |

Progress is printed every 5 s. The report contains, per operation (`trade.spot.place`, `public.orderbook`,
`ws.connect`, `ws.lag`, …): count, errors by status/code, rate, mean, p50/p90/p95/p99/max; counters (order
outcomes, dropped sockets) and gauges (connected sockets, frames/s and MB/s, frames/s and average size per
event type). `ws.lag` is publish → delivery time measured on a 2% sample of frames, so generator and servers
must share a clock (same host, or NTP-synchronised hosts).

## 3. Larger tests

- One generator process handles about 5,000 WebSocket clients plus a few hundred HTTP users before its own
  event loop distorts the latency it measures. Run several viewer-only processes
  (`--readers 0 --accounts 0 --traders 0 --userOffset N`) plus one mixed process, and merge the reports.
- For multi-million-connection tests, run many generator machines against a production-sized staging stack,
  each with its own slice of users. Raise file-descriptor limits (`ulimit -n`), widen
  `net.ipv4.ip_local_port_range`, and spread connections over several source IPs or load-balancer addresses
  (about 64 k connections per source IP to one destination address and port).
- Watch the services while testing: `/metrics` on every service (engine queue depth, settlement failures,
  WebSocket connections and coalescing), the gateway's `/health` (connections, CPU, event-loop delay, backlog)
  and MariaDB lock waits (`information_schema.innodb_lock_waits`).
