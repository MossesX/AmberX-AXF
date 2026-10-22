# Patches

**One banner, three tabs.** The Dev Console, Build Pilot and axHub in one Android app, built on **AmberX AXF 0.2.0**
(`android-compose` template, developer app). Brett, Oct 21 2026 (Fable).

- The banner is Patches' own (`banner/patches`: the Patches mark, day/night switch, clock, settings button). The apps in
  the tabs hide theirs: every tab's web view says `AXF-Embed/patches` in its user agent (**embed@1**,
  `framework/core/engines/embed.ts` = Kotlin `EmbedEngine`), and an AXF app that sees that marker hides the chrome the
  host shows — the banner by default — over the user's own choice, which stays saved for when it runs on its own.
- Tabs: the nav-menu asset `patches-tabs` as top tabs (layout `patches-tabs`): **Console** (`console.amberxai.com`),
  **Pilot** (`pilot.amberxai.com`), **axHub** (the hub's app catalog, then anywhere on the hub). Each tab is a `WebAppView`
  (lib-hub) kept alive in a `WebAppHolder` for the activity's life, so switching tabs keeps every app where it was.
- Web views are locked to their app's origin plus the hub's (the sign-in wall's round trip); other http(s) links open in
  the phone's browser; JavaScript and DOM storage on (they are web applications), no file/content access, no mixed
  content, hub APK downloads only.
- One sign-in: the developer-app waiting screen signs in on the hub's own page; that session cookie is every tab's
  session and the one the look + settings come from (axHub's data server, like the other developer apps).
- Settings → Patches: the Console and Pilot addresses (https host only), reload the tab in front, open it in the browser.
- Build Pilot has no Android app yet, so its tab is the web app; native tabs are a placeholder capability (`patches.native-tabs`).

Open this folder in Android Studio, or `gradle :app:assembleDebug`. CI builds it with every other app (`patches-debug.apk`,
app catalog on the hub). The framework is a composite build from `../../framework/android` (`settings.gradle.kts`).

| Path | Purpose |
| --- | --- |
| `axf.manifest.json` | App identity, framework version, targets, default asset per slot (`developer.hub` = the hub) |
| `app/src/main/assets/axf/` | Copy of the manifest + every hot-swappable asset, shipped in the APK (Patches' own: `layout/patches-tabs`, `nav-menu/patches-tabs`, `banner/patches`) |
| `app/src/main/kotlin/…/App.kt` | Builds and starts the kernel (`AxfApplication`); `HubModule` for the look + settings |
| `app/src/main/kotlin/…/MainActivity.kt` | Single activity: `AxfRoot` + `AppShell` + the tab views; owns the `WebAppHolder` |
| `app/src/main/kotlin/…/AppModule.kt` | The tabs (routes), the Patches settings group, reload / open actions, placeholders |
| `app/src/main/kotlin/…/views/TabView.kt` | One tab's content: its web view out of the holder |

Validate conformance at any time: `node ../../framework/cli/axf.mjs validate .`
