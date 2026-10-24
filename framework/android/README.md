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

## Windows, tab groups, docking

`WindowManager` (kernel contract, service `axf.windows`) holds every window, tab group and nested pane layout;
`axf-ui/windows` renders them: `DockArea` for the main window, `FloatingWindowsHost` (mounted by AxfRoot) for
floating windows, minimized title bars per corner (stacked or lined up) and floating mini-toolbars at the cursor.
Tab groups undock into DOCK windows (toolbar forced on, built-in toolbar: settings · redock · minimize to
corner · minimize to toolbar · close, or a `toolbar` asset chosen in Window settings — the settings icon is
always appended inside a floating window). Long-press-drag moves tabs between groups and windows. The
`tab-group` context menu carries the Split submenu (vertical / horizontal / four-way / custom grid…); tabs
are distributed evenly across the new groups. Apps register tab kinds through `TabRenderers`. The `window`
asset (framework/android/assets/window) sets per-kind defaults; toolbars carry `data.window` naming the
window they attach to.

## Building

Requires Android Studio Ladybug+ / AGP 8.7, JDK 17, and network access to `maven.google.com`,
`repo1.maven.org` and `dl.google.com`. `./gradlew :axf-kernel:test` runs the kernel + conformance tests;
`./gradlew publishToMavenLocal` publishes every module as `ai.amberx.axf:<module>:<version>`.

## Installable libraries, the install wizard and UI-library imports

- Any module with a `library.json` (`library@1`: id, features, `manifestKey`, `params[]`, `install{gradle,module,import}`) is **installable**: `axf libraries` lists them, `axf install <lib> <appDir>` runs an interactive wizard for the parameters (or `--param k=v --yes`), writes `axf.manifest.json → <manifestKey>`, the gradle dependency, the `App.kt` module entry and a generated `<Name>Setup.kt` holding the answers as typed Kotlin. `axf init … --libraries browser` and a boilerplate's `libraries` field do the same at pre-build time; the Dev Console's **Install** button drives the same wizard through `POST /install`.
- `lib-browser` is the first one: the floating library-browser tab groups (select → compare → undock / drag / split / minimize / tree-or-grid explorer) as a reusable library bound to the tab groups named in `libraries.browser.tabGroups`.
- `lib-voice` (Oct 20 2026, from Voice Vault): speech in (`SpeechInput`, on-device recognizer for secret speech), spoken prompts (`Speaker`), and an open registry of voice commands whose trigger phrases users record, type or pick from defaults (`VoiceTriggersScreen`, route `voice-triggers`). Matching is pure Kotlin (`PhraseMatcher`).
- `lib-lock` (Oct 20 2026, from Voice Vault): second-step unlock by strong biometrics or a PIN (salted PBKDF2), lockout, auto-lock delay, set/change PIN screen; fills `android.biometric`. Since then `AxfActivity` is a `FragmentActivity` so libraries can show `BiometricPrompt`.
- `lib-hub` (Oct 20 2026 harvest, from AXHub; first slice): axHub as it exists today — `HubRules` (pure: hub address rules, hub URLs, the approvals feed of axHub decision #85 and its ok / signed-out / not-admin / unreachable mapping, seen ids; replays `spec/fixtures/hub-approvals.json` with the web port `framework/libs/hub`), `HubClient` (`feed()` with the app's own hub session from a `HubSession`, WebView cookie store by default, no redirects, 256 KB cap; `signOut()` posts the hub's CSRF form), `WatchPrefs` + `HubState` flows, `LockedWebView(origin, url)` (no JS unless asked, no file/content access, no mixed content, third-party cookies off, every navigation and redirect checked against the origin) and `hubApkDownloads` (hub `/apps/download/<project>/<file>.apk` only, through DownloadManager with the session cookie). Placeholders `axf.hub.axpp` (AXPP, parked for Fable), `axf.hub.push`, `axf.hub.admin-api`.
- `lib-notifications` (Oct 20 2026 harvest, from AXHub): fills `android.notifications` — channels (`ChannelSpec`), `canPost` (POST_NOTIFICATIONS), `canFullScreen` (API 34), `ongoing` (the quiet "watching" notification), `alert` (high priority, VISIBILITY_PRIVATE with a public version, so the lock screen only shows its public text; full screen only when asked and allowed; never over the lock screen), `notice`, cancel by tag or id, and `deliverAlert` / `AlertNotifications.plan`, the hook for alert@1 deliveries on channel `device` (not wired yet: placeholder `axf.notifications.alerts`).
- `lib-work` (Oct 21 2026 harvest, from AXHub, Fable): fills `android.work` — the host for work@1 poll jobs: `PollJob` (a kernel `JobSpec` + flags + a suspend body + `ForegroundSpec`), `PollJobs` registry (start / stop / checkNow / setInterval, running + state flows, `restartAfterBoot`), `PollService` (foreground, specialUse; one `JobRunner` per job driving the kernel's `WorkEngine` state machine and carrying out its effects; START / CHECK_NOW / STOP / INTERVAL commands; a refused foreground start stops quietly; START_STICKY), `WorkBootReceiver`, `WorkModule(jobs)`. The app's manifest adds the `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property on `ai.amberx.axf.work.PollService`. Placeholders: `axf.work.manager` (the kernel's `axf.work` WorkScheduler on WorkManager), `axf.work.alarm`, `axf.work.chain`.
- `lib-selection` (Oct 24 2026 harvest, from X Select): entries in every app's text selection menu (`ACTION_PROCESS_TEXT`): `ProcessTextActivity` base (cleaned text, read-only flag, entry tapped, hand text back), `SelectionMenuEntries` (switch entries on/off at run time), pure `SelectionRules`. Provides `android.process-text`.
- `lib-readaloud` (Oct 24 2026 harvest, from X Select): `ReadAloud.read(context, text)` with foreground playback (`ReadAloudService`, mediaPlayback) and notification controls, audio focus, sleep timer, queue + history + repeat, live `state` (piece, word, voices, engines); pure `ReadAloudPrefs`/`ReadAloudRanges` (54 clamped prefs), `TextPrep`, `TextChunker`, `ReadQueue`; `ReadAloudSettings.groups(prefix, tab, module)`. Placeholders `axf.readaloud.media-session`, `.save-audio`, `.web`.
- **Plugins** (`plugin-*`, plugin@1 `kind: module` + `plugin.json`): compiled modules an app adds to its module list. First: `plugin-xselect` (X Select, Oct 24 2026): Read aloud next to Select all in every app, settings-only `xselect` view, axHub badge on the banner. App wiring: `implementation(project(":plugin-xselect"))` + `ReadAloudModule(this, settingsPrefix = null), SelectionModule(), XSelectModule(this)`.
- **Import** on a third-party UI library (`axf import-ui`, console wizard, `POST /import-ui`): clones the library (git/local) or records it (maven/npm), refactors the sources to AXF tokens (`Color(0x…)`, `MaterialTheme.colorScheme.*`, typography, radii → `Axf.*` via `AxfPorted`, mapping in `tokens.map.json`), saves `kit-<id>` (an `AxfUiKit` + module + `library.json`) and the `ui-kit` asset, and applies it to the open project as its default kit. The kit is a hot-swappable asset like any other; kinds it does not cover fall back to the default AmberX kit, noted on the **output terminal** (`terminal.open`).
