# Porting AmberX AXF to another stack

AXF is one framework with several **ports** (Android/Kotlin, React/Next/TypeScript/Node, Python/PyQt6, …).
A port is quick to write because almost everything is already shared and language-neutral:

| Shared by every port | Where |
| --- | --- |
| Asset format (`asset@1`) and every starter asset | `framework/assets/**`, `framework/schemas/asset-types.json` (+ per-port extension specs such as `asset-types.android.json`) |
| Manifest / lock / plugin formats | `framework/schemas/*.json`, `app-structure.json`, `plugin.schema.json` |
| Engine behaviour (theme, layout, component style, UAC, context menu, actions, validation) | `framework/spec/fixtures/*.json` — golden outputs generated from the reference TypeScript engines |
| Standard vocabularies | action ids (`StandardActions`), UAC permission ids, extension-point ids, route/settings/work/session/plugin contracts (`framework/android/axf-kernel/.../contract`, mirrored in `framework/core/types.ts`) |
| Plugin inventory (`plugin-inventory@1`: dependencies, dependents, health, clashes, graph) | `framework/core/engines/plugins.ts` = `axf-kernel/.../plugins/PluginInventoryEngine.kt` = the console plugin's `server/engine.py`; fixture `spec/fixtures/plugin-inventory.json` |
| axHub connector, first slice (hub address rules, hub URLs, approvals feed + status mapping, seen ids) | `framework/libs/hub/hub.ts` = `framework/android/lib-hub/.../HubRules.kt`; fixture `spec/fixtures/hub-approvals.json` |
| Work (`work@1`: poll-job specs with interval bounds, per-outcome back-off, one-time notices, run conditions; the job state machine whose effects a host carries out) | `framework/core/engines/work.ts` = `axf-kernel/.../work/WorkEngine.kt`; fixture `spec/fixtures/work.json` (`spec/check-work.mts`, `WorkConformanceTest`); Android host `framework/android/lib-work` |
| Interop contracts (protocol-neutral) | `framework/spec/INTEROP.md` — action/event descriptors, exposure, call origins, `surface@1`, wire error codes, protocol adapters (`axf-kernel/.../interop`; **not yet mirrored in `framework/core`**) |
| Build engine | `framework/cli/*.mjs` — `init`, `validate`, `new-asset`, `new-module`, `new-demo`, `dev`; a port adds a template folder with a `template.json` |
| Feature catalog + tracker | `framework/catalog/*.json`, `tracker.json` — the console shows every port's status from the same data |

## What a new port implements

1. **Kernel core** (pure, UI-free): envelope parse, open type registry, validator, registry, the six engines, runtime state + hot-swap, action bus, module/extension registry, event bus, flags, config, migrations. Port the Kotlin kernel or the TypeScript `framework/core` — they are the same design, file for file.
2. **Platform seams**: clock, ids, dispatchers/threads, key-value store, secure store, logger, telemetry, permissions, file layout, work scheduler, session provider, plugin loader. (`platform/Platform.kt`, `contract/*.kt`.)
3. **UI layer** that reads only the compiled tokens: theme → native theme, `CompiledLayout` → native layout regions, `ComponentStyles` → native widgets with every variant, menus/toolbars/nav/context menus/dialogs/toasts from the typed assets. The web port's `framework/ui/axf.css` + `framework/react` and the Android `axf-ui` are the two references.
4. **App template** for `axf init --template <port>` (a `template.json` + boilerplate), and a bootstrap (the port's equivalent of `AxfApplication` + `AxfRoot` + `AppShell`).
5. **Interop gate**: `AxfInterop` (descriptors, exposure + grant + role checks, schema check, audit) and the adapter extension point, with the same wire error codes — see `INTEROP.md`.
6. **Conformance test** that loads `framework/assets` and asserts the fixture outputs (see `ConformanceTest.kt` for the Kotlin version).

Regenerate fixtures after changing a reference engine: `npx -y tsx framework/spec/gen-fixtures.mts`.

## Port status

| Port | Stack | Status |
| --- | --- | --- |
| web | React + TypeScript (Vite) | built — reference engines |
| android | Kotlin + Jetpack Compose | built (kernel) / in progress (UI, libraries, console app) |
| react-next | Next.js + Node build-engine API | planned (shares `framework/core` + `framework/react` as-is) |
| python | Python kernel + PyQt6 UI | planned |
| desktop, ios, wear, tv, auto, web-component | — | placeholders in the port registry |
