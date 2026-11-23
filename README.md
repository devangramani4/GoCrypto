# GoCrypto

An exchange-style crypto trading platform: **spot**, **USDT-margined perpetual futures** and **options**, with
a price-time priority matching engine, a real-time risk engine, TradingView-style charts and live order books —
on **web**, **desktop** (Windows/macOS/Linux) and **mobile** (iOS/Android), plus an RBAC **admin back-office**.

> **Sandbox by default.** The platform runs in `TRADING_MODE=SANDBOX`: paper trading with simulated custody and
> deposits. Before handling real money, custody, exchange, derivatives, KYC/AML, financial, tax and other
> regulatory requirements must be reviewed for every jurisdiction where it will operate. See
> [docs/SECURITY.md](docs/SECURITY.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#going-live-real-funds).

## Features

- **Spot** — limit, market (by quantity or quote amount), stop-limit, stop-market, take-profit, OCO; GTC/IOC/FOK,
  post-only; amend; self-trade prevention; price protection bands.
- **Perpetual futures** — cross/isolated margin, tiered leverage and maintenance margin, mark/index price,
  8-hourly funding, reduce-only, attached TP/SL, conditional orders on mark or last price, event-driven
  liquidation engine with insurance fund.
- **Options** — European calls/puts, live chain with bid/ask/last, volume, open interest, IV and Greeks,
  trade from the chain, margined shorts, exactly-once expiry settlement.
- **Wallet** — deposits (addresses, QR, networks, confirmations; sandbox simulator), withdrawals with address
  validation, limits, PIN/2FA/email verification and risk review, transfers between accounts and users,
  append-only ledger history.
- **Portfolio** — balances, allocation, performance, PnL, positions, order/trade/funding history, notifications.
- **Security** — Argon2id, JWT access + rotating refresh tokens with reuse detection, TOTP 2FA with backup
  codes, PIN, sessions & devices, HMAC API keys, rate limits, audit logs.
- **Admin** — users, markets, fees, orders, wallet review, reports, security monitoring, roles & permissions,
  audit logs, settings, system health.

## Architecture

```
apps/        web (React + Vite) · desktop (Electron) · mobile (React Native/Expo) · admin (React)
services/    api · websocket · matching-engine · risk-engine · market-data · workers
packages/    shared-types · trading-utils · validation · server-core · api-client · ui
database/    SQL migrations, migration/seed CLIs, seed data
infrastructure/  docker · nginx · pm2 · monitoring (Prometheus, Grafana)
docs/        architecture, API, WebSocket, security, deployment, testing
```

All business logic lives in the backend; clients render state and call the API. MariaDB is the source of
truth (`DECIMAL(36,18)`, row locks, atomic settlement); Redis carries engine commands, events, caches and
locks. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Requirements: Node 22, pnpm 10, MariaDB 10.11+ (or MySQL 8), Redis 7.

```bash
pnpm install
cp .env.example .env               # set DATABASE_URL, REDIS_URL and secrets (never commit .env)
pnpm db:migrate && pnpm db:seed    # schema + reference data (+ sandbox demo user and admin)
pnpm dev                           # backend services + web app → http://localhost:5173
pnpm dev:admin                     # admin console → http://localhost:5174
```

Desktop: `pnpm --filter @gocrypto/desktop dev` · Mobile: `pnpm --filter @gocrypto/mobile start` (Expo).

With Docker: `docker compose up -d --build` (web on :8080, admin on :8081; add `--profile monitoring` for
Prometheus and Grafana). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Common scripts

| Command                                                    | Purpose                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:backend`                            | Run everything / only the backend services with hot reload                    |
| `pnpm build` / `pnpm build:backend`                        | Build all packages and apps / bundle backend services and DB CLIs             |
| `pnpm lint` · `pnpm typecheck`                             | ESLint · TypeScript across the monorepo                                       |
| `pnpm test:unit` · `pnpm test:integration`                 | Pure unit suites · API integration & financial-safety suite (MariaDB + Redis) |
| `pnpm --filter @gocrypto/web test`                         | Web app tests (also `@gocrypto/admin`, `@gocrypto/api-client`)                |
| `pnpm db:migrate` · `db:rollback` · `db:seed` · `db:reset` | Database lifecycle (reset is refused in production)                           |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — services, order lifecycle, consistency model, derivatives
- [REST API](docs/API.md) — conventions, errors, endpoints, admin permissions
- [WebSocket API](docs/WEBSOCKET.md) — channels, events, auth
- [Security](docs/SECURITY.md) — identity, financial integrity, withdrawals, hardening
- [Deployment](docs/DEPLOYMENT.md) — environments, Docker, PM2, Nginx/TLS, scaling, monitoring, releases
- [Testing](docs/TESTING.md) — suites and the guarantees they prove
- [Desktop app](apps/desktop/README.md)
