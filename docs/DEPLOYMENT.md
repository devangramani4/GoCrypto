# Deployment

## Environments

|                        | Development                   | Staging                    | Production                                        |
| ---------------------- | ----------------------------- | -------------------------- | ------------------------------------------------- |
| `NODE_ENV` / `APP_ENV` | `development`                 | `production` / `staging`   | `production` / `production`                       |
| `TRADING_MODE`         | `SANDBOX`                     | `SANDBOX`                  | `SANDBOX` until the regulatory review is complete |
| Market data            | `SIMULATED`                   | `SIMULATED` or `EXTERNAL`  | `EXTERNAL` (`MARKET_DATA_URL`)                    |
| Secrets                | `.env` (dev defaults allowed) | secret manager             | secret manager (startup refuses dev defaults)     |
| TLS                    | none                          | edge proxy / load balancer | edge proxy / load balancer + HSTS                 |
| Topology               | single host (`pnpm dev`)      | docker compose or VMs      | VMs/Kubernetes with managed MariaDB + Redis       |

Configuration is environment-only (12-factor). `.env.example` documents every variable; the most important:

| Variable                                                             | Purpose                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                       | `mysql://user:pass@host:3306/gocrypto` (MariaDB 10.11+ / MySQL 8)                                    |
| `REDIS_URL`                                                          | Redis 7 (`noeviction` policy — queues and engine streams must not be evicted)                        |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                                   | Different random strings, ≥ 32 chars (`openssl rand -base64 48`)                                     |
| `ENCRYPTION_KEY`                                                     | base64 32-byte key for AES-256-GCM (2FA and API-key secrets) — back it up; losing it invalidates 2FA |
| `API_KEYS`                                                           | Internal service API keys for automation                                                             |
| `MARKET_DATA_URL`, `MARKET_DATA_MODE`                                | External index feed                                                                                  |
| `EMAIL_CONFIG`, `SMS_CONFIG`, `PUSH_PROVIDER`                        | Notification channels (`log` in development)                                                         |
| `CORS_ORIGINS`, `WEB_APP_URL`, `ADMIN_APP_URL`, `DESKTOP_APP_ORIGIN` | Allowed browser origins                                                                              |
| `TRUST_PROXY`                                                        | `true` behind Nginx/LB so rate limits and audit logs see the client IP                               |
| `ENGINE_MODE`                                                        | `redis` (dedicated matching-engine service) or `inprocess` (single node)                             |
| `ENGINE_SHARDS`, `ENGINE_SHARD`, `ENGINE_SHARD_PINS`                 | Matching-engine sharding by market (same shards/pins everywhere; `ENGINE_SHARD` per engine instance) |
| `WS_MAX_CONNECTIONS`, `WS_SHED_CPU`, `WS_SHED_LOOP_DELAY_MS`         | Gateway admission control (refuse new connections when full / saturated)                             |
| `METRICS_TOKEN`                                                      | Bearer token for `/metrics` (keep metrics on the private network either way)                         |

## Local development

```bash
pnpm install
cp .env.example .env            # fill DATABASE_URL / REDIS_URL / secrets
pnpm db:migrate && pnpm db:seed  # schema + assets, markets, fees, system accounts, admin (+ demo user)
pnpm dev                         # all backend services + web on http://localhost:5173
pnpm dev:admin                   # admin console on http://localhost:5174
pnpm --filter @gocrypto/desktop dev
pnpm --filter @gocrypto/mobile start
```

## Docker Compose (staging / single host)

```bash
cp .env.example .env   # set DB_PASSWORD, DB_ROOT_PASSWORD, JWT_*, ENCRYPTION_KEY, GRAFANA_ADMIN_PASSWORD
docker compose up -d --build                 # http://localhost:8080 (admin on :8081)
docker compose --profile monitoring up -d    # Prometheus 127.0.0.1:9090, Grafana 127.0.0.1:3000
docker compose logs -f api matching-engine
```

- `infrastructure/docker/backend.Dockerfile` builds one image for all backend services (the command selects
  the service) plus the `migrate`/`seed` CLIs. `frontend.Dockerfile` builds the web (`APP=web`) or admin
  (`APP=admin`) SPA into an Nginx image.
- Start order is enforced by health checks: MariaDB/Redis → `migrate` (migrations + idempotent seed) →
  services → edge Nginx. Containers run as non-root with a read-only filesystem.
- The edge proxy (`infrastructure/nginx`) routes `/api/` and `/socket.io/` to the backend, serves the SPAs,
  applies rate limits and security headers, and never exposes `/metrics`, `/ready` or `/docs`.
  `conf.d/gocrypto-tls.conf.example` is the TLS variant (HTTP→HTTPS redirect, HSTS, OCSP stapling,
  admin host restricted to internal networks).

## PM2 (VMs without containers)

```bash
pnpm install --frozen-lockfile && pnpm build:backend
node database/dist/migrate.js up && node database/dist/seed.js
pm2 start infrastructure/pm2/ecosystem.config.cjs --env production
pm2 save && pm2 startup
```

Serve `apps/web/dist` and `apps/admin/dist` (built with `pnpm --filter @gocrypto/web build`) from Nginx using
the same configuration as the compose edge proxy.

## Scaling and availability

| Component                | Strategy                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api, websocket, workers  | Stateless — run N replicas behind the proxy. WebSocket uses the websocket transport only (no sticky sessions); fan-out goes through Redis. Run one gateway process per core (PM2 cluster mode / one container per vCPU) and use `/ready` (503 while full or saturated) as the readiness probe and `/health` as liveness.     |
| matching-engine          | Sharded by market: `ENGINE_SHARDS=N`, one deployment per shard with its own `ENGINE_SHARD` (and `METRICS_PORT` when shards share a host), each with a hot standby (Redis leader election per shard). Pin the busiest books to dedicated shards with `ENGINE_SHARD_PINS`. Drain the engines before changing the shard layout. |
| risk-engine, market-data | Redis leader election: run 2 instances, one active, one hot standby that takes over when the leader's lease expires. The engine rebuilds its books from the database on takeover.                                                                                                                                            |
| MariaDB                  | Primary with semi-sync replica; `READ-COMMITTED`, binlog `ROW`, `innodb_flush_log_at_trx_commit=1`, `sync_binlog=1`. Point-in-time recovery from binlogs + nightly `mariabackup`.                                                                                                                                            |
| Redis                    | Persistence (AOF `everysec`), `noeviction`; Sentinel or a managed service for failover. Redis holds no money state — the database is the source of truth.                                                                                                                                                                    |

## Migrations

- Numbered SQL files in `database/migrations` with `-- +migrate Up` / `-- +migrate Down` sections. Applied by
  `pnpm db:migrate` / `node database/dist/migrate.js up` under a database advisory lock (safe with several
  replicas starting at once) and tracked with checksums in `schema_migrations` (changes to an already-applied
  migration are reported). `down` exists for development — production rolls forward.
- In production: take a backup, apply migrations before rolling out code that needs them, keep changes
  backward compatible for one release (expand → migrate → contract). `migrate.js reset` is refused in production.

## Zero-downtime release checklist

1. CI green (lint, typecheck, unit, integration, image builds).
2. Back up the database; run migrations (`docker compose run --rm migrate`).
3. Roll stateless services one replica at a time (`api`, `websocket`, `workers`).
4. Roll the matching engine: start the new standby, stop the old leader (SIGTERM drains the command chains;
   the standby acquires leadership and rebuilds books). Repeat for risk-engine and market-data.
5. Deploy the web/admin images; desktop and mobile releases go through their stores/update channels.
6. Watch the Grafana dashboard and alerts (settlement failures, engine backlog, 5xx rate, stale market data).

## Monitoring

- Every service exposes Prometheus metrics (`/metrics`): HTTP latency/status, order admission results, trades,
  engine command latency and queue depth, book sizes, WebSocket connections/subscriptions, liquidations,
  funding, deposits/withdrawals, background jobs, market-data ticks, auth events, DB pool usage.
- `infrastructure/monitoring/prometheus/alerts.yml` ships alerts for services down, settlement failures,
  engine backlog/latency, API error rate and latency, liquidation spikes, stale market data and failing jobs.
- Grafana is provisioned with the "GoCrypto — Platform overview" dashboard.
- Logs are structured JSON (pino) with request ids; ship them with your log collector of choice.

## Going live (real funds)

Real-money operation is out of scope of the sandbox defaults. At minimum: complete the jurisdictional
regulatory review (custody, exchange, derivatives, KYC/AML, tax), integrate a real custody provider behind the
`CustodyProvider` interface (hot/cold wallet separation, signing in an HSM/MPC), add KYC/AML screening,
external security audit and penetration test, incident response and proof-of-reserves processes, then set
`TRADING_MODE=LIVE` with `LIVE_TRADING_ACKNOWLEDGEMENT=REGULATORY_REVIEW_COMPLETED`.
