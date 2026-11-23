# REST API (v1)

Base path: `/api/v1`. Interactive OpenAPI docs are served by the API at `/docs` (internal network only;
the edge proxy does not expose them). A typed client is available in `packages/api-client`.

## Conventions

| Topic       | Rule                                                                                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoding    | JSON, UTF-8. Timestamps are Unix epoch **milliseconds**.                                                                                                                                                                                                                                                                         |
| Decimals    | Every price, quantity, balance, fee and rate is a **string** (`"0.00125"`). Never parse them into floating point for arithmetic.                                                                                                                                                                                                 |
| Auth        | `Authorization: Bearer <accessToken>` (JWT, 15 min). Web clients refresh through an httpOnly cookie (send `X-GC-Client: web`); native clients send `{ refreshToken }` to `POST /auth/refresh`.                                                                                                                                   |
| API keys    | `X-GC-APIKEY`, `X-GC-TIMESTAMP` (ms), `X-GC-SIGNATURE = hex(HMAC_SHA256(secret, timestamp + METHOD + path + body))`. Permissions: `READ`, `TRADE`, `WITHDRAW` (withdraw requires an IP allow-list).                                                                                                                              |
| Devices     | Optional `X-Device-Id` / `X-Device-Name` / `X-Platform` headers feed device management and new-device alerts.                                                                                                                                                                                                                    |
| Idempotency | Money-moving POSTs accept `Idempotency-Key` (the client generates one per submission): a repeat returns the cached original response for 24h, and `409 IDEMPOTENCY_CONFLICT` while the first request is still in flight. Withdrawals and transfers also take an `idempotencyKey` in the body, enforced by a unique database key. |
| Pagination  | Cursor pages `{ items, nextCursor }` (`?cursor=&limit=`) for user history; offset pages `{ items, page, pageSize, total }` in admin.                                                                                                                                                                                             |
| Rate limits | Global per user/IP (Redis-backed, `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`) plus a per-user order rate (`ORDER_RATE_LIMIT_PER_SEC`). The edge proxy adds stricter limits for auth and withdrawal endpoints. `429` responses include `retry-after`.                                                                            |

### Errors

```json
{
  "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient USDT balance", "details": [] },
  "requestId": "req-1x2y"
}
```

Validation errors use `VALIDATION_ERROR` with `details: [{ path: "/price", message: "Price is required" }]`.
Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INVALID_CREDENTIALS`,
`MFA_REQUIRED`, `ACCOUNT_LOCKED`, `ACCOUNT_FROZEN`, `TRADING_DISABLED`, `MARKET_CLOSED`, `FILTER_VIOLATION`
(tick size, step size, min/max quantity, min notional — the message names the filter), `PRICE_OUT_OF_BAND`,
`INSUFFICIENT_BALANCE`, `INSUFFICIENT_MARGIN`, `LEVERAGE_TOO_HIGH`, `POST_ONLY_REJECTED`, `REDUCE_ONLY_REJECTED`,
`DUPLICATE_ORDER`, `IDEMPOTENCY_CONFLICT` (same key still in flight), `NO_LIQUIDITY`, `WITHDRAWAL_LIMIT_EXCEEDED`,
`WITHDRAWAL_LOCKED`, `SANDBOX_ONLY`. The full list is in `packages/shared-types/src/errors.ts`.

## Public

| Method & path                                                                                       | Description                                                                            |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /system/status`                                                                                | `{ mode: SANDBOX\|LIVE, serverTime, version, simulatedDeposits }`                      |
| `GET /assets`                                                                                       | Assets with networks (confirmations, minimums, withdrawal fees, explorer URL template) |
| `GET /markets?type=SPOT\|FUTURES\|OPTIONS`                                                          | Markets with filters, precision, base fee rates, futures risk tiers, option terms      |
| `GET /markets/tickers?type=`                                                                        | 24h tickers (futures include mark, index, funding, next funding, open interest)        |
| `GET /markets/{symbol}` · `/ticker` · `/mark`                                                       | Single market, ticker, mark price                                                      |
| `GET /markets/{symbol}/orderbook?depth=50&step=`                                                    | Depth snapshot, optional price aggregation step                                        |
| `GET /markets/{symbol}/trades?limit=`                                                               | Recent public trades                                                                   |
| `GET /markets/{symbol}/candles?interval=1m…1M&from=&to=&limit=`                                     | OHLCV candles                                                                          |
| `GET /futures/funding-rates/{symbol}`                                                               | Funding history                                                                        |
| `GET /options/underlyings` · `/options/expiries?underlying=` · `/options/chain?underlying=&expiry=` | Options chain with bid/ask/last, IV, Greeks, OI, volume                                |

## Authentication & account (`/auth`, `/users`)

| Method & path                                                                   | Description                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /auth/register`                                                           | `{ email, password, displayName?, referralCode?, acceptTerms: true }` → user + tokens |
| `POST /auth/login`                                                              | → `{ status: 'OK', user, tokens }` or `{ status: 'MFA_REQUIRED', mfaToken }`          |
| `POST /auth/login/2fa`                                                          | `{ mfaToken, code \| backupCode }`                                                    |
| `POST /auth/oauth/google` · `/auth/oauth/apple`                                 | ID-token sign-in (JWKS-verified)                                                      |
| `POST /auth/refresh` · `/auth/logout`                                           | Rotate refresh token (reuse revokes the session) · end session                        |
| `POST /auth/email/send-verification` · `/auth/email/verify`                     | Email OTP verification                                                                |
| `POST /auth/phone/send-otp` · `/auth/phone/verify`                              | SMS OTP verification                                                                  |
| `POST /auth/password/forgot` · `/auth/password/reset` · `/auth/password/change` | Password recovery / change (locks withdrawals for 24h)                                |
| `POST /auth/2fa/setup` · `/2fa/enable` · `/2fa/disable`                         | TOTP with backup codes                                                                |
| `POST /auth/pin` · `PUT /auth/pin` · `POST /auth/pin/verify`                    | Security PIN (lockout on repeated failures)                                           |
| `GET /auth/security`                                                            | Security overview and score                                                           |
| `GET/DELETE /auth/sessions[/{id}]`                                              | Active sessions; revoke one or all others                                             |
| `GET/PATCH/DELETE /auth/devices[/{id}]`                                         | Devices (rename, trust, remove)                                                       |
| `POST/DELETE /auth/devices/push-token`                                          | Register / unregister this device's push token                                        |
| `GET /auth/login-history`                                                       | Login attempts (success and failures)                                                 |
| `GET/PATCH /users/me` · `GET/PUT /users/me/settings`                            | Profile, anti-phishing code, notification preferences                                 |
| `GET/POST/DELETE /users/me/api-keys[/{id}]`                                     | API keys (secret shown once; requires 2FA)                                            |

## Trading

| Method & path                                                                                       | Description                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /spot/orders`                                                                                 | `{ symbol, side, type: LIMIT\|MARKET\|STOP_LIMIT\|STOP_MARKET\|TAKE_PROFIT_*, price?, stopPrice?, quantity? \| quoteQuantity?, timeInForce?: GTC\|IOC\|FOK, postOnly?, clientOrderId? }` |
| `POST /spot/orders/oco`                                                                             | `{ symbol, side, quantity, price, stopPrice, stopLimitPrice? }`                                                                                                                          |
| `PATCH /spot/orders/{id}`                                                                           | Amend price / quantity                                                                                                                                                                   |
| `DELETE /spot/orders/{id}` · `DELETE /spot/orders?symbol=`                                          | Cancel one / all                                                                                                                                                                         |
| `POST /futures/orders`                                                                              | Spot fields plus `reduceOnly`, `closePosition`, `workingType: MARK_PRICE\|LAST_PRICE`, `takeProfitPrice`, `stopLossPrice`                                                                |
| `GET /futures/account` · `/futures/positions` · `/futures/settings/{symbol}`                        | Margin account, positions (live uPnL, liquidation price, margin ratio)                                                                                                                   |
| `POST /futures/leverage` · `/futures/margin-mode`                                                   | Per-contract leverage (tier-limited) and CROSS/ISOLATED                                                                                                                                  |
| `POST /futures/positions/{symbol}/close` · `/margin` · `/tpsl`                                      | Market close (optionally partial), isolated margin add/remove, position TP/SL                                                                                                            |
| `GET /futures/funding-history` · `/futures/liquidations`                                            | Funding payments, own liquidations                                                                                                                                                       |
| `POST /options/orders`                                                                              | `{ symbol, side, type: LIMIT\|MARKET, price?, quantity, timeInForce?, postOnly?, reduceOnly? }`                                                                                          |
| `GET /options/account` · `/options/positions` · `/options/settlements`                              | Options margin account, positions with Greeks, expiry settlements                                                                                                                        |
| `GET /orders?marketType=&symbol=&status=&side=&from=&to=` · `GET /orders/open` · `GET /orders/{id}` | History, open orders, detail with fills and state history                                                                                                                                |
| `DELETE /orders/{id}` · `DELETE /orders?symbol=`                                                    | Cancel (any market type)                                                                                                                                                                 |
| `GET /trades?marketType=&symbol=`                                                                   | Own fills (fees, maker/taker, realized PnL)                                                                                                                                              |

Order responses are `{ order: OrderDto, fills: FillDto[] }`. Market orders usually return already filled;
limit orders return `OPEN`/`PARTIALLY_FILLED`; trigger orders `NEW` with `triggerState: PENDING`.

## Wallet & portfolio

| Method & path                                                                                        | Description                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /wallet/overview` · `GET /wallet/balances?account=&includeZero=`                                | Balances per account (SPOT, FUTURES, OPTIONS) with USD values                                                         |
| `GET /wallet/deposit-address?asset=&network=` · `GET /wallet/deposits`                               | Deposit address (+memo) and history with confirmations                                                                |
| `POST /wallet/deposits/simulate`                                                                     | Sandbox only: create a simulated on-chain deposit                                                                     |
| `GET /wallet/withdrawals/limits?asset=&network=`                                                     | Fee, minimum, available, daily USD limit, required verifications                                                      |
| `POST /wallet/withdrawals/email-code`                                                                | Send the withdrawal email code                                                                                        |
| `POST /wallet/withdrawals`                                                                           | `{ asset, network, address, memo?, amount, pin?, totpCode?, emailCode?, idempotencyKey, saveToAddressBook?, label? }` |
| `DELETE /wallet/withdrawals/{id}` · `GET /wallet/withdrawals`                                        | Cancel while pending review · history                                                                                 |
| `POST /wallet/transfer`                                                                              | Between own accounts (`from`, `to`; derivatives accounts are USDT-only)                                               |
| `POST /wallet/internal-transfer`                                                                     | To another user by email/UID (PIN/2FA when enabled)                                                                   |
| `GET /wallet/transfers` · `GET /wallet/history`                                                      | Transfers · full ledger (every balance change)                                                                        |
| `GET/POST/DELETE /wallet/address-book` · `POST /wallet/validate-address`                             | Saved addresses · network-specific address validation                                                                 |
| `GET /portfolio/summary` · `/allocation` · `/holdings` · `/performance?range=` · `/positions`        | Portfolio analytics                                                                                                   |
| `GET /notifications` · `/notifications/unread-count` · `POST /notifications/{id}/read` · `/read-all` | In-app notifications                                                                                                  |

## Admin (`/admin`)

Every admin route requires a staff role **and** the listed permission; role → permission assignments are
stored in the database and editable by `SUPER_ADMIN`. Mutations are written to the audit log with the actor,
IP and reason.

| Area             | Endpoints                                                                                                                                                | Permission                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Session          | `GET /admin/me`                                                                                                                                          | staff role                                      |
| Dashboard        | `GET /admin/dashboard`                                                                                                                                   | `dashboard.read`                                |
| Users            | `GET /admin/users`, `GET/PATCH /admin/users/{id}`, `.../login-history`, `.../orders`, `.../ledger`                                                       | `users.read` / `users.write`                    |
| Account controls | `POST .../freeze`, `.../unfreeze`, `.../disable`                                                                                                         | `users.freeze`                                  |
|                  | `POST .../trading`                                                                                                                                       | `users.trading`                                 |
|                  | `POST .../reset-security`, `.../revoke-sessions`                                                                                                         | `users.security`                                |
|                  | `GET/PUT/DELETE .../fees`                                                                                                                                | `fees.read` / `fees.write`                      |
|                  | `POST .../adjust-balance` (sandbox)                                                                                                                      | `wallet.adjust`                                 |
| Markets          | `GET /admin/markets`, `POST /admin/markets/spot`, `/futures`, `PATCH /admin/markets/{id}`, `PUT .../risk-tiers`, `POST .../reload`, `GET /admin/options` | `markets.read` / `markets.write` / `risk.write` |
| Fees             | `GET/PUT /admin/fees`, `PATCH /admin/assets/{asset}/networks/{network}`                                                                                  | `fees.read` / `fees.write`                      |
| Orders           | `GET /admin/orders`, `POST /admin/orders/{id}/cancel`, `GET /admin/trades`, `GET /admin/liquidations`                                                    | `orders.read` / `orders.cancel` / `risk.read`   |
| Wallet           | `GET /admin/deposits`, `GET /admin/withdrawals`, `POST /admin/withdrawals/{id}/review`, `GET /admin/balances`                                            | `wallet.read` / `withdrawals.review`            |
| Reports          | `GET /admin/reports/revenue`, `/reports/transactions`                                                                                                    | `reports.read`                                  |
| Security         | `GET /admin/security/logins`, `/alerts`, `/ips`, `/devices`, `/2fa`, `POST .../alerts/{id}/resolve`                                                      | `security.read` / `security.write`              |
| Roles            | `GET /admin/roles`, `PUT /admin/roles/{code}/permissions`                                                                                                | `roles.read` / `roles.write`                    |
| Audit            | `GET /admin/audit-logs`                                                                                                                                  | `audit.read`                                    |
| Settings         | `GET/PUT /admin/settings`                                                                                                                                | `settings.read` / `settings.write`              |
| System           | `GET /admin/system/health`                                                                                                                               | `system.read`                                   |

Default roles: `SUPER_ADMIN` (everything), `ADMIN` (all but role edits, settings writes and balance
adjustments), `FINANCE`, `TRADING_MANAGER`, `SUPPORT`, `RISK_MANAGER`, `VIEW_ONLY` — see
`packages/shared-types/src/permissions.ts`.
