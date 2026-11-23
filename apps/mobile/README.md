# GoCrypto mobile (iOS & Android)

Bare **React Native 0.88** app (New Architecture, Hermes): no Expo. The native projects in `android/` and
`ios/` are regular source code — edit them directly, there is no prebuild step. All trading logic stays on
the backend; the app renders state and calls the REST API / WebSocket gateway through `@gocrypto/api-client`.

## Prerequisites

- Node 22 and pnpm (from the repository root: `pnpm install`)
- **Android**: JDK 17, Android Studio (SDK Platform 37, Build-Tools 37.0.0, NDK 27.1.12297006 and CMake are
  installed on first build), an emulator or a device with USB debugging
- **iOS** (macOS only): Xcode 16+, Ruby with Bundler for CocoaPods

## Run in development

```bash
pnpm dev:backend                                  # API + WebSocket + engine (repository root)
pnpm --filter @gocrypto/mobile start              # Metro bundler
pnpm --filter @gocrypto/mobile android            # build + install on the emulator/device
pnpm --filter @gocrypto/mobile pods               # iOS, first time and after native dependency changes
pnpm --filter @gocrypto/mobile ios                # build + run in the iOS simulator
```

`localhost` in the API/WebSocket URLs is rewritten in development builds to the machine running Metro (physical
devices) or to `10.0.2.2` (Android emulator), so the defaults work without extra configuration.

## Configuration

Public, build-time settings come from environment variables that Babel inlines into the bundle
(`babel.config.js`, `src/config.ts`). They are visible in the app binary — **never put secrets in them**.

| Variable           | Default                 | Purpose                                                       |
| ------------------ | ----------------------- | ------------------------------------------------------------- |
| `GOCRYPTO_API_URL` | `http://localhost:4000` | REST API base URL                                             |
| `GOCRYPTO_WS_URL`  | `http://localhost:4001` | WebSocket gateway URL                                         |
| `GOCRYPTO_WS_PATH` | `/socket.io`            | Socket.IO path                                                |
| `GOCRYPTO_SANDBOX` | `true`                  | `false` hides paper-trading helpers (e.g. simulated deposits) |

Metro caches transformed files: after changing a variable restart it with `pnpm --filter @gocrypto/mobile start --reset-cache`.
Release builds bundle the JavaScript inside Gradle / Xcode, so export the variables in that shell, e.g.
`GOCRYPTO_API_URL=https://api.example.com ./gradlew assembleRelease`.

## Push notifications (Firebase Cloud Messaging)

Push uses `@react-native-firebase/messaging`; FCM delivers to Android directly and to iOS through APNs. The
Firebase configuration files are **environment-specific and never committed** (they are git-ignored). Without
them the app builds and runs normally and push registration reports "not configured".

1. Create a Firebase project and register the Android app (`com.gocrypto.app`) and the iOS app (`com.gocrypto.app`).
2. Download `google-services.json` to `android/app/` and `GoogleService-Info.plist` to `ios/GoCrypto/`
   (CI writes them from its secret store before building).
3. iOS: upload an APNs authentication key in the Firebase console (Project settings → Cloud Messaging) and enable
   the Push Notifications capability for the App ID. The entitlement is in `ios/GoCrypto/GoCrypto.entitlements`.
4. Backend: set `PUSH_PROVIDER=fcm` and `FCM_SERVICE_ACCOUNT` (service-account key JSON, from the secret manager)
   for the workers service — see `.env.example`.

Android notifications use the `default` channel ("Trading & account alerts") created in `MainApplication.kt`; the
channel id and accent colour are set in `firebase.json`.

## Security notes

- Tokens, the device id and preferences live in the iOS Keychain / Android Keystore (`src/lib/secureStorage.ts`,
  react-native-keychain): device-only items, never synced to iCloud or backed up.
- The biometric app lock (`src/lib/biometrics.ts`) reads a Keychain/Keystore item that the OS only releases after
  Face ID / Touch ID / fingerprint or the device passcode — JavaScript never decides on its own.
- Release builds disallow cleartext HTTP on Android (`usesCleartextTraffic` is only on for debug builds); iOS keeps
  App Transport Security on (local networking only for development).

## Release builds

**Android**: release signing reads Gradle properties, normally from `~/.gradle/gradle.properties` or
`ORG_GRADLE_PROJECT_*` environment variables in CI — never from the repository:

```properties
GOCRYPTO_UPLOAD_STORE_FILE=/secure/path/upload.keystore
GOCRYPTO_UPLOAD_STORE_PASSWORD=…
GOCRYPTO_UPLOAD_KEY_ALIAS=upload
GOCRYPTO_UPLOAD_KEY_PASSWORD=…
GOCRYPTO_VERSION_CODE=42   # monotonically increasing, e.g. the CI build number
```

```bash
cd android && ./gradlew bundleRelease   # app/build/outputs/bundle/release/app-release.aab for Google Play
```

`versionName` follows `package.json`. Without the signing properties the release build is left unsigned.

**iOS**: open `ios/GoCrypto.xcworkspace` in Xcode, select your team for signing, then Product → Archive. Keep
`MARKETING_VERSION` (Xcode "Version") in sync with `package.json` and raise `CURRENT_PROJECT_VERSION` for every
upload.

## Tests and checks

```bash
pnpm --filter @gocrypto/mobile test          # Jest; native modules are in-memory fakes (__mocks__/)
pnpm --filter @gocrypto/mobile typecheck
pnpm --filter @gocrypto/mobile bundle:android && pnpm --filter @gocrypto/mobile bundle:ios   # release JS bundles
```

The `Mobile` GitHub Actions workflow builds an unsigned Android release APK and an iOS simulator release build on
pull requests that touch the app or the shared packages.
