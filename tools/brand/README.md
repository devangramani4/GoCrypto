# @gocrypto/brand

Writes every GoCrypto logo file from one definition: `packages/ui/src/brand.ts` (a blue shield with a white
"G"). To change the logo, edit that file and run:

```bash
pnpm --filter @gocrypto/brand generate
```

| Generated file                                                                                                                | Used for                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web/public/favicon.svg`, `apps/web/public/apple-touch-icon.png`                                                         | Web app and desktop renderer: browser tab, iOS home-screen bookmark   |
| `apps/admin/public/favicon.svg`                                                                                               | Admin panel tab                                                       |
| `apps/desktop/resources/icon.png`                                                                                             | electron-builder, which makes the Windows `.ico` and macOS `.icns`    |
| `apps/mobile/android/app/src/main/res/drawable/ic_launcher_{background,foreground,monochrome}.xml`, `mipmap-anydpi-v26/*.xml` | Android 8+ launcher icon; `monochrome` is the Android 13+ themed icon |
| `apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher{,_round}.png`                                                      | Launchers on Android 7                                                |
| `apps/mobile/android/app/src/main/res/drawable/ic_notification.xml`                                                           | Push-notification icon in the status bar                              |
| `apps/mobile/ios/GoCrypto/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png`                                                | iOS app icon (no alpha channel, as the App Store requires)            |
| `apps/mobile/ios/GoCrypto/Images.xcassets/LaunchLogo.imageset/`                                                               | Logo on the iOS launch screen                                         |

The logos inside the apps (`Logo` and `LogoMark` in `packages/ui`, and `apps/mobile/src/components/Logo.tsx`) read
`brand.ts` directly, so they change without running the generator.
