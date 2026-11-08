<!-- memory-chunk@1 source=_claude/memory/docs/axf-architecture.md tokens=492 -->
## Android port (`framework/android`)

| Module | Role |
| --- | --- |
| `axf-kernel` (pure Kotlin, no Android imports) | asset envelope/open type registry/validator, typed models, the six engines, `AxfRuntime`, module system + extension points + typed placeholders, event bus, feature flags, layered config, migrations + semver + deprecations, `AxfStore` (state management), `QueryClient` (fetch + cache), contracts: routes, settings schema, work scheduler, session/principal/audit, plugins (`plugin@1`), UI kits, ports, strings, icons |
| `axf-platform-android` | SharedPreferences KV, EncryptedSharedPreferences secure store, logcat logger, permissions via ActivityResult, file layout, `AxfApplication` + `AxfActivity` |
| `axf-assets` | ships framework/assets + framework/android/assets in the APK; remote source for hot reload |
| `axf-ui` | tokens → `AxfTheme` (+ Material 3 bridge), `AxfRoot`, `AppShell` (regions per window class), components, menus, overlays, **UI-kit switching** (`AxfComponents`; Material3Kit default, UnstyledKit second), studio views, settings renderer |
| `axf-nav` / `axf-data` / `axf-network` | Router on Navigation Compose + `axf://` deep links; DataStore prefs, JSON documents, offline-first repository, DB registry; OkHttp client, websocket, remote config |
| `lib-settings`, `lib-logging` | real libraries with generated UI |
| `lib-admin`, `lib-accounts`, `lib-profile`, `lib-billing` | placeholder modules: contracts, mock providers, screens, `NotImplemented` capabilities |
| `axf-devtools`, `axf-testing` | kernel status, flags, action/event logs, asset inspector, build-engine client, hot reloader; fakes + test rules |

Design rules fixed at this build (Foundations): pure-Kotlin kernel; namespaced ids; API level + semver per module; explicit public API; tokens are the only way to style; every capability is either implemented or a typed placeholder; new asset types/extension points/plugins never require kernel changes.
