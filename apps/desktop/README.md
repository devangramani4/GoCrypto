# GoCrypto Desktop

Electron shell around the GoCrypto web app (`apps/web`, built with `--mode desktop`) for Windows, macOS and Linux.
All trading logic stays on the backend; the desktop app adds a resizable multi-panel workspace, native
notifications and OS-keychain token storage.

## Run

```bash
pnpm --filter @gocrypto/web dev          # renderer dev server on :5173
pnpm --filter @gocrypto/desktop dev      # Electron pointed at the dev server
# or a production-like run from the built renderer:
pnpm --filter @gocrypto/desktop build && pnpm --filter @gocrypto/desktop start
```

## Configuration

Endpoints are resolved in this order: `GOCRYPTO_API_URL` / `GOCRYPTO_WS_URL` environment variables,
then `<userData>/config.json`:

```json
{ "apiUrl": "https://api.gocrypto.example", "wsUrl": "https://ws.gocrypto.example" }
```

Packaged builds refuse non-HTTPS endpoints (loopback excepted). The backend must allow the renderer
origin `app://gocrypto` (`DESKTOP_APP_ORIGIN`, included in CORS by default).

## Packaging

```bash
pnpm --filter @gocrypto/desktop dist:win     # NSIS installer (x64, arm64)
pnpm --filter @gocrypto/desktop dist:mac     # dmg + zip (x64, arm64), hardened runtime
pnpm --filter @gocrypto/desktop dist:linux   # AppImage + deb
```

The app icon, `resources/icon.png`, is generated from the shared logo: run
`pnpm --filter @gocrypto/brand generate` after changing `packages/ui/src/brand.ts`.

Code signing and notarization credentials are read by electron-builder from the CI environment
(`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, …) — never commit them.

## Security

- Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP (served via the `app://` protocol
  handler), navigation and `window.open` locked to the app; external links open in the system browser.
- Preload bridge (`window.gocryptoDesktop`) exposes only: config, secure store (`auth` key only),
  notifications and open-external (http/https only). Every IPC handler validates the sender origin.
- Tokens are encrypted with `safeStorage` (DPAPI / Keychain / libsecret). Without real OS encryption
  (e.g. Linux `basic_text`), tokens are kept in memory only and never written in plain text.
- Permission requests are denied except notifications and sanitized clipboard writes.
