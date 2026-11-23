# Security

> **Regulatory notice.** GoCrypto runs in `TRADING_MODE=SANDBOX` (paper trading, simulated custody) by
> default. Before handling real funds, custody, exchange, derivatives, KYC/AML, financial, tax and other
> regulatory requirements must be reviewed for every jurisdiction the platform will operate in. The backend
> refuses to start with `TRADING_MODE=LIVE` unless `LIVE_TRADING_ACKNOWLEDGEMENT=REGULATORY_REVIEW_COMPLETED`.

## Identity and sessions

- **Passwords**: Argon2id (`@node-rs/argon2`), never stored or logged in plain text; policy ≥ 10 characters
  with upper/lower case and a digit. Logins are throttled and accounts lock after repeated failures; the
  response never reveals whether an email exists.
- **Tokens**: short-lived HS256 access JWTs (15 min) and rotating refresh tokens bound to a server-side
  session. Reusing a rotated refresh token revokes the whole session (theft detection). Revoked sessions
  are pushed to Redis so every API/WebSocket node rejects them immediately.
- **Web**: access token in memory only; refresh token in an `httpOnly`, `Secure`, `SameSite=Strict` cookie
  scoped to `/api/v1/auth`. Cookie-authenticated requests must also carry the custom `X-GC-Client` header,
  which cross-site forms cannot send (CSRF defence in depth).
- **Desktop**: tokens encrypted with the OS keychain (Electron `safeStorage`); memory-only when no real
  OS encryption is available. **Mobile**: iOS Keychain / Android Keystore via react-native-keychain
  (device-only items, never synced to iCloud) + optional biometric app lock gated by the OS (Face ID / Touch ID /
  fingerprint or device passcode). Build-time `GOCRYPTO_*` settings are public and never hold secrets.
- **2FA**: TOTP (RFC 6238) with replay protection (a code is accepted once) and single-use backup codes;
  TOTP secrets are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`).
- **Security PIN** for withdrawals and internal transfers, with lockout.
- **Devices & sessions**: users can list, rename, trust and remove devices, revoke sessions, and review the
  login history. New-device logins trigger notifications and security alerts. Push tokens are detached when a
  device no longer has a live session.
- **API keys**: HMAC-SHA256 signed requests with a timestamp window and replay protection, per-key
  permissions (`READ`/`TRADE`/`WITHDRAW`), IP allow-lists (mandatory for `WITHDRAW`), secrets encrypted at rest
  and shown exactly once. Creating keys requires 2FA.

## Authorization

- Every private route authenticates the caller and derives the user id from the token — never from the
  request body. Private WebSocket channels are joined server-side from the token.
- Admin RBAC: roles (`SUPER_ADMIN`, `ADMIN`, `FINANCE`, `TRADING_MANAGER`, `SUPPORT`, `RISK_MANAGER`,
  `VIEW_ONLY`) map to fine-grained permissions stored in the database; every admin route checks a permission,
  and every mutation is audit-logged with actor, IP and reason.

## Financial integrity

- No JavaScript floating point for money: `DECIMAL(36,18)` columns, decimal strings on the wire, `decimal.js`
  everywhere in code. Balances carry `CHECK (available >= 0 AND locked >= 0)` constraints.
- **Never trust the client** for balances, prices, margin, fees or execution: reservations use the engine's
  book snapshot or the mark price, fees come from the fee schedule, positions and PnL are computed server-side.
- Atomic settlement: one DB transaction per engine command with row locks in a fixed order
  (`orders → wallets → positions`); deadlocks are retried; failures roll back and the in-memory book is rebuilt.
- Idempotency keys for orders, withdrawals and transfers; unique trade sequence per market; liquidation is
  guarded by four independent layers against double execution.
- Every balance change writes an append-only ledger entry; tests assert that the ledger reconciles with
  balances after every scenario.

## Withdrawals

- Address validation per network format with checksums where the format has one (EIP-55 for EVM,
  base58check for BTC/TRON), memo handling, optional address book.
- Server-side limits: minimum amount, per-network fee, 24h USD limit by verification (KYC) level, and
  "never more than available" enforced under a row lock.
- Required verifications (PIN, TOTP, email code) depending on the account's security settings.
- Risk scoring (large amount, new address, new account, no 2FA, full-balance sweep, velocity) routes
  withdrawals to manual review; withdrawals are locked (24h by default, `withdrawal.security_lock_hours`)
  after a password reset or change, disabling 2FA, a PIN change, or an admin security reset.
- Funds are moved to `locked` at request time; rejection or cancellation unlocks them atomically.

## Transport and platform hardening

- HTTPS only in production (TLS terminated at the edge; HSTS), secure headers via Helmet and Nginx
  (CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).
- CORS allow-list (`CORS_ORIGINS`, plus the desktop origin `app://gocrypto`); credentials only for listed
  origins.
- Input validation with zod on every route (body, query, params); request body size limits.
- Redis-backed rate limits per user/IP, stricter edge limits for authentication and withdrawals.
- Containers run as a non-root user with a read-only root filesystem, dropped capabilities and
  `no-new-privileges`. Metrics, readiness and API docs are internal-only.
- Electron renderer: `contextIsolation`, `sandbox`, no Node integration, strict CSP, validated IPC.

## Secrets

- All secrets come from the environment (`.env` locally, a secret manager in staging/production) — never
  from source control. `.env` files are git-ignored; `.env.example` documents every variable.
- In production the backend refuses to start with the development defaults for `JWT_SECRET`,
  `JWT_REFRESH_SECRET` or `ENCRYPTION_KEY`, or when both JWT secrets are equal.
- Clients never contain secrets: the web/desktop/mobile apps only know public endpoints.

## Reporting

Security issues should be reported privately to the maintainers (do not open public issues). Include
reproduction steps and affected versions.
