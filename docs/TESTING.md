# Testing

| Layer                              | Location                                                 | Command                                         |
| ---------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Trading math & formatting          | `packages/trading-utils/src/__tests__`                   | `pnpm --filter @gocrypto/trading-utils test`    |
| Validation schemas                 | `packages/validation/src/schemas.test.ts`                | `pnpm --filter @gocrypto/validation test`       |
| Matching engine (pure order book)  | `services/matching-engine/src/engine/order-book.test.ts` | `pnpm --filter @gocrypto/matching-engine test`  |
| Risk rules                         | `services/risk-engine/src/rules.test.ts`                 | `pnpm --filter @gocrypto/risk-engine test`      |
| API client transport               | `packages/api-client/src/http.test.ts`                   | `pnpm --filter @gocrypto/api-client test`       |
| API integration & financial safety | `services/api/test/*.test.ts`                            | `pnpm test:integration` (needs MariaDB + Redis) |
| Web app                            | `apps/web/src/**/*.test.tsx`                             | `pnpm --filter @gocrypto/web test`              |
| Admin console                      | `apps/admin/src/**/*.test.ts(x)`                         | `pnpm --filter @gocrypto/admin test`            |

`pnpm test:unit` runs the pure unit suites; CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit and
frontend tests, the integration suite against MariaDB/Redis service containers, and builds the container images.

## Integration environment

The integration suite boots the real Fastify app with the matching engine **in process**, against a dedicated
database and Redis DB (defaults in `services/api/test/setup-env.ts`):

```bash
export TEST_DATABASE_URL=mysql://gocrypto:password@127.0.0.1:3306/gocrypto_test
export TEST_REDIS_URL=redis://127.0.0.1:6379/1
pnpm test:integration
```

Each file starts from a freshly migrated and seeded schema. After every scenario the suite asserts that the
**ledger reconciles with balances** and that locked spot funds equal the open orders' reservations.

## What the critical tests prove

**Authentication & authorization** — Argon2id hashing, no account enumeration, lockout after failures,
refresh-token rotation with reuse detection, immediate revocation on logout, TOTP 2FA (replayed codes
rejected), PIN lockout, password change revoking other sessions and locking withdrawals, HMAC API keys with
per-key permissions, admin RBAC per permission, push tokens detached on logout and on shared installs.

**Spot** — price-time priority, maker/taker fees with conservation of balances, GTC rest/cancel with exact
fund release, insufficient balance and filter violations without side effects, market buys by quote amount,
IOC/FOK/post-only semantics, amend (priority kept on size reduction, re-queued on price change), OCO, stop
orders fired by the trigger monitor.

**Concurrency & double spend** — exactly as many concurrent orders accepted as the balance allows; duplicate
`clientOrderId` under concurrency; `Idempotency-Key` replay; racing takers never over-fill a maker.

**Duplicate trades & rollback** — the same match can never settle twice; a failure mid-settlement rolls back
the whole transaction; non-negative balances are also enforced by database constraints.

**Withdrawals & deposits** — of two concurrent withdrawals exceeding the balance only one succeeds; concurrent
requests with the same idempotency key create one withdrawal; processing/rejection/cancellation have
exactly-once balance effects; a deposit is credited exactly once even if confirmations are processed twice.

**Derivatives** — leveraged long with initial margin, fees and realized PnL; leverage tiers, reduce-only and
margin sufficiency; futures withdrawable balance capped by unrealized losses; isolated liquidation exactly
once under concurrent attempts; cross liquidation against the whole cross balance; funding settled exactly once
per funding time; options: buying calls, margined short puts and exactly-once cash settlement at expiry.

**Frontend** — login and 2FA, registration validation, order placement with exact decimal payloads,
client-side filter/balance checks, double-submit protection, order-book price fill, withdrawals never above the
available balance and idempotent retries, dashboard and portfolio rendering; admin login/2FA, permission
guards, tables, role matrix, withdrawal review and request bodies validated against the API schemas.

## Manual / end-to-end

With the stack running (`pnpm dev`), a Playwright pass can register a user, simulate a deposit, place spot
limit and market orders, transfer to futures, open a position, browse the options chain and portfolio, and
toggle the pro layout and themes. The Electron app can be smoke-tested headlessly with
`xvfb-run` + Playwright's `_electron.launch`.
