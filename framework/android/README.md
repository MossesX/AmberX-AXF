# AmberX AXF — Android port

Kotlin + Jetpack Compose port of the framework. The kernel is pure Kotlin (no Android imports) so it can
move to desktop/iOS/JS later; everything Android-specific sits behind the kernel's platform seams.

## Module map

| Module | Package | Role |
| --- | --- | --- |
| `axf-kernel` | `ai.amberx.axf.kernel` | Asset envelope/registry/validator, typed models, the six engines, `AxfRuntime`, module system + extension points + typed placeholders, event bus, feature flags, layered config, migrations, state store, query/cache engine, contracts (routes, settings, work, session, plugins, UI kits, ports). |
| `axf-platform-android` | `ai.amberx.axf.platform` | Android implementations of the seams (SharedPreferences KV, encrypted secure store, logcat logger, permissions via ActivityResult, file layout), `AxfApplication` + `AxfActivity` bootstrap. |
| `axf-assets` | `ai.amberx.axf.assets` | Ships `framework/assets/**` (+ `framework/android/assets/**`) in the APK and loads them; remote/hot-reload source behind `axf.hotReload`. |
| `axf-ui` | `ai.amberx.axf.ui` | Tokens → `AxfTheme` (+ Material 3 bridge), `AxfRoot`, `AppShell` (layout regions per window class), components, menus, overlays, UI-kit switching, studio views, settings renderer. |
| `axf-nav` | `ai.amberx.axf.nav` | Router on Navigation Compose: typed routes, `axf://<app>/<route>` deep links, results. |
| `axf-data` | `ai.amberx.axf.data` | DataStore preferences, JSON document store, offline-first repository base, DB registry. |
| `axf-network` | `ai.amberx.axf.network` | OkHttp client with retries/cache/auth seam, websocket, remote config. |
| `lib-settings` / `lib-logging` | `ai.amberx.axf.settings` / `.logging` | Schema-driven settings UI; logging engine + viewer + crash capture + diagnostics. |
| `lib-admin` / `lib-accounts` / `lib-profile` / `lib-billing` | | Placeholder modules: contracts, stubs, mock providers. |
| `axf-devtools` / `axf-testing` | | Kernel status, event log, asset inspector, build-engine client; fakes and test rules. |

## Bootstrapping an app

```kotlin
class App : AxfApplication() {               // reads assets/axf/axf.manifest.json + every bundled asset, builds + starts the kernel
    override fun modules() = listOf(SettingsModule(), LoggingModule(), DevtoolsModule(), AppModule())
}
class MainActivity : AxfActivity() {         // AxfRoot (theme, locals, overlays) is provided for you
    @Composable override fun Content() = AppShell(views = mapOf("home" to { HomeView() }))
}
```

`axf init my-app --template android-compose` generates exactly this (see `framework/templates/android-compose`).

## How the web demo's look maps to Compose

| Web | Android |
| --- | --- |
| `--fx-*` CSS variables (theme.ts) | `ThemeTokens` → `AxfTheme.colors / typography / shapes / spacing / motion`; `tokens.cssVars` still available for WebView hosts |
| `data-fx-btn` / `data-fx-card` / … attributes | `ComponentStyles` (button, slider, container, dialog, popup, contextMenu) read by every component |
| CSS grid areas (layout.ts) | `CompiledLayout.rows/columns` rendered by `AppShell`; phone grid on COMPACT, rail on MEDIUM |
| `.fx-nav` list / pills / rail | `AxfNav` (+ bottom tabs, drawer) |
| `.fx-toolbar` icons / icons-labels / labels | `AxfToolbar` |
| dialog modal / drawer / sheet | `AxfDialogHost` |
| toast positions / variants | `AxfToastHost` |

## Switching UI kits (third-party widget libraries)

Every public component (`AxfButton`, `AxfSlider`, `AxfCard`, …) dispatches to the kit selected by the
hot-swappable `ui-kit` asset. To add a kit: implement `AxfComponents` (subclass `DefaultComponents` and
override only the kinds you replace), expose it as an `AxfUiKit` with a `UiKitSpec`, contribute it to
`ExtensionPoints.UI_KITS` from your module's `register()`, and ship a `ui-kit` asset `{ "kit": "<id>" }`.
Kinds a kit does not cover fall back to Material 3. `UnstyledKit` (foundation only) is the worked example;
swap `ui-kit` to `unstyled` in the component gallery to see it.

## Building

Requires Android Studio Ladybug+ / AGP 8.7, JDK 17, and network access to `maven.google.com`,
`repo1.maven.org` and `dl.google.com`. `./gradlew :axf-kernel:test` runs the kernel + conformance tests;
`./gradlew publishToMavenLocal` publishes every module as `ai.amberx.axf:<module>:<version>`.
