<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md tokens=608 -->
## Added — Patches (`apps/patches`)

- `axf init apps/patches --template android-compose --developer https://axhub.amberxai.com --libraries hub`: app id
  `patches`, package `ai.amberx.axf.patches`, project manifest `patches` (repo `MossesX/patches` reserved, `exists: false`),
  hub folder `/projects/patches`. Validates (`axf validate`: 69 assets; `axf project validate --all`: 7 projects clean).
- Own assets: `layout/patches-tabs` (nav top, no menubar / toolbar / status / inspector, full width; mobile `top-tabs`,
  no app bar), `nav-menu/patches-tabs` (pills, bar indicator: **Console · Pilot · axHub**), `banner/patches` (28 px: the
  Patches mark; right: day/night switch, clock, settings button). Manifest hides `toolbar` + `app-menu`; starts on `console`.
- Code: `App.kt` (modules + `HubModule` with the WebView cookie credentials → look + settings from the hub, waits for it),
  `AppModule.kt` (three routes, Settings → **Patches**: Console / Pilot addresses (https host only, bad = default),
  *Reload the tab in front*, *Open the tab in front in the browser*; placeholders `patches.native-tabs`, `patches.web`,
  `patches.bridge`), `views/TabView.kt`, `MainActivity.kt` (owns the `WebAppHolder("patches")`, hub sign-in on the
  waiting screen, destroys the views when finishing).
- **lib-hub `WebAppView` + `WebAppHolder`** (`framework/android/lib-hub/.../WebAppView.kt`): a web *application* view
  (JavaScript + DOM storage on, cache on, media needs a gesture) locked to an origin **list** (the app's + the hub's, for
  the sign-in wall's round trip; other http(s) → the phone's browser; a redirect off the list is stopped before it
  renders; nothing loads at all off the list), user agent + `AXF-Embed/patches`, no file/content access, no mixed content,
  third-party cookies off, safe browsing on, downloads only through `hubApkDownloads`. The holder keeps one WebView per tab
  for the activity's life and reparents it on tab switches (page, scroll and state survive), exposes `loading` / `url`
  flows per tab, `reload(tab)`, `drop(tab)`, `destroy()`. `LockedWebView` (hub pages, no JS) is unchanged.
- CI: `android.yml` already builds every app `app-bundle.mjs list --android` finds; added the named artifact
  `patches-debug.apk`. The app catalog on the hub gets Patches on the next green main.
- Catalog: `k.embed` (built, kernel), `c.patches` (built, apps/patches), note on `w.webview`; tracker regenerated.
