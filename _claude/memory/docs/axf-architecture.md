# AmberX AXF — cross-platform app framework (v0.2.0)

AmberX AXF builds apps whose entire UI is made of **hot-swappable assets**. Every theme, layout, menu, toolbar,
dialog, popup, button, slider, container and access policy is a JSON asset in one shared format (`asset@1`),
so any app built on AmberX AXF on any port (web, Android, …) can load any other app's assets.

```
amberx-axf/
├── framework/
│   ├── core/  react/  ui/        web port: TypeScript engines + runtime (reference implementation), React layer, axf.css
│   ├── android/                  Android port (Kotlin + Jetpack Compose) — see below
│   ├── assets/                   39 shared starter assets (13 core types × 3); android/assets/ holds port-specific ones (ui-kit)
│   ├── schemas/                  asset-types.json (single source of truth) + asset-types.android.json (optional port types) + plugin.schema.json
│   ├── spec/                     PORTING.md + fixtures/ — golden engine outputs every port must reproduce (ConformanceTest)
│   ├── catalog/                  catalog.json (feature checklist) + status.json → tracker.json at the repo root
│   ├── boilerplates/             categorized boilerplate.json bundles (16 across 9 categories) + index.json
│   ├── templates/                react-ts, android-compose (app), android-module (library) — each with template.json
│   ├── cli/                      build-engine.mjs, axf.mjs, dev-server.mjs (live reload), serve.mjs (HTTP driver), tracker.mjs, boilerplates.mjs
│   └── defaults.json             default asset per slot, baked into every new app
├── apps/demo/                    web demo (xaf.amberxai.com)
├── apps/console/                 AXF Dev Console — first Android app (tracker, catalog, library picker, demos, modules, boilerplate manager)
└── tracker.json                  what's built / partial / placeholder / planned, per feature
```

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

## Engines

| Engine | Input asset(s) | Output |
| --- | --- | --- |
| Theme | `color-theme`, `style-theme` | web: `--fx-*` CSS variables · android: `ThemeTokens` (colors incl. derived extended tokens, style tokens) |
| Layout | `layout` (+ optional `mobile` block) | web: CSS grid · android: `CompiledLayout` per window class (COMPACT/MEDIUM/EXPANDED) |
| Component style | `button`, `slider`, `container`, `dialog`, `popup`, `context-menu` | variables/attributes · `ComponentStyles` |
| User account control | `uac-policy` | role → permissions (inheritance, wildcards), hide/disable gating |
| Context menu | `context-menu` | per-target menus with `{payload}` substitution |
| Action | menus, toolbars, shortcuts | command bus, standard vocabulary, interceptors |
| Module / extension | modules | dependency-ordered lifecycle, typed extension points, placeholders |
| State / query | app code | `AxfStore` (reducer, middleware, undo, persistence), `QueryClient` (stale-while-revalidate, dedup, retries, invalidation) |

## Build engine

```bash
node framework/cli/axf.mjs init apps/my-app --template android-compose --boilerplate notes --name "My Notes"
node framework/cli/axf.mjs validate apps/my-app      # structure + assets per the template's template.json
node framework/cli/axf.mjs new-module media --label "Media" --capabilities android.media
node framework/cli/axf.mjs new-demo media            # apps/demo-media showcasing one library
node framework/cli/axf.mjs templates | boilerplates | modules
node framework/cli/axf.mjs dev apps/console          # live-reload assets to devices (HMR for everything that is JSON)
node framework/cli/axf.mjs serve --token secret      # HTTP driver used by the Dev Console (run on the VPS)
node framework/cli/tracker.mjs                       # regenerate tracker.json
npx -y tsx framework/spec/gen-fixtures.mts           # regenerate conformance fixtures from the reference engines
```

## Status (Oct 16 2026)

Written but **not yet compiled** — this sandbox cannot reach maven.google.com / dl.google.com. First build on a
machine with Android Studio: `cd apps/console && ./gradlew :app:assembleDebug` (fix-ups expected on first compile).
Wave 2 candidates: real work scheduler (WorkManager), accounts/billing providers, GitHub + VPS libraries,
10× themes/styles/layouts, MCP driver for the build engine, Next.js and Python/PyQt6 ports.

## Deploying the web demo (xaf.amberxai.com)

`.github/workflows/deploy.yml` builds `apps/demo` on every push to `main` and publishes `dist/` to the `site`
branch; the VPS pulls it (one-time setup: `deploy/install.sh`).
