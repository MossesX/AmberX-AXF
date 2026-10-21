# Rebuild report — `plugin-manager` (Fable rebuild, Oct 20 2026, branch `fable/plugin-manager`)

**Summary.** The Opus Plugin Manager was a web-console-only plugin whose dependency logic lived in one Python file.
The Fable rebuild turns that logic into a **framework contract, `plugin-inventory@1`**: one engine (TypeScript reference
`framework/core/engines/plugins.ts`, Kotlin `PluginInventoryEngine` in `axf-kernel`, and a Python copy in the plugin's
server part) that resolves what a plugin needs (`service:<capability>`, `plugin:<id>`, env, scopes, framework level,
console API), whether each need is met (satisfied / provider off / missing / not installed / unsupported), who provides it,
**who needs it**, its health, the clashes (duplicate id, two providers, duplicate contribution, shared data folder, two
enabled UI editors) and even the dependency-graph layout — all pinned by one fixture replayed on every port. On top of it:
the web console plugin keeps every Opus feature (five views, four layouts, terminal commands, context-menu link, logs,
files, lifecycle panel, inline settings, catalog Install view) with the same id, folder, actions and settings keys;
Android gets a real Plugin Manager (`PluginManagerModule` + `PluginManagerScreen` in `axf-devtools`, same ids, in the
Android console showcase and the `android-compose` template); and **every `axf init` app now ships the settings interface
with a Plugins tab** that lists its libraries with health, dependents and clashes from the same engine (web `libs/settings`
and Android `lib-settings`), plus a Settings entry in the starter nav and app menus.

## Removed
- The Opus plugin folder was removed first with its `uninstall.mjs --all`
  (commit `468df70`): folder deleted, the three marked doc lines stripped, `plugin-lifecycle.mjs check --after-uninstall`
  clean. The new build was then installed in the same folder.
- `server/inventory.py` no longer contains its own resolver (`_providers`, `_dependencies`, `_dependents`, `_health`,
  `_conflicts`); it gathers facts and calls the shared engine.
- `web/model.ts`: the hand-written offline inventory, `webConflicts()` and the duplicated health/label tables are gone
  (the engine and `installedLibraryRecord` replace them). `web/views.tsx`: the hand-laid graph columns are gone
  (`pluginGraph` from the engine lays it out; the view only maps columns/rows to pixels).

## Kept
- Plugin id `ai.amberx.axf.console.plugin-manager`, folder `plugin-manager`, actions `plugin-manager.open[:<folder>]`, <!-- axf-plugin:plugin-manager -->
  `plugin-manager.window`, `plugin-manager.layout:<id>`, `plugin-manager.view:<id>`, settings keys
  `plugin-manager.layout|view|filter|sort|selected`, settings sub-tab under Plugins, the default context-menu link
  (runtime contribution, never written into an asset), the `plugin-manager.row` context target.
- All five views (Cards, Table, Detail with Overview/Dependencies/UI & settings/Logs/Files/Install, Dependencies graph,
  Install from the plugin catalog) and all four layouts (Studio, Mission control, Terminal with its command line,
  Catalog with hero + shelves); the UI-editor rule (`usePrefs` → `useEditorSync`, per-key saves).
- Server routes `GET /inventory`, `/plugin/{folder}`, `/logs/{folder}` with every guard (folder pattern, level whitelist,
  no symlinks in file lists / sizes, env reported as set/unset only, read-only), console token on every method, 404 when
  disabled, never on the console MCP. Enable/disable and install/uninstall still go through the console's own routes.
- `hooks.mjs` checks (data folder, "menu link not baked into a context-menu asset"), `install.mjs`, `uninstall.mjs`,
  lifecycle block and the three marked doc mentions (CLAUDE.md, plugins README, decisions).

## Changed
- **Model = framework engine.** `web/model.ts` types now extend the engine's `PluginInventoryItem`; the browser
  re-resolves the server's records together with the bundle's web contributions (view/dialog/settings-tab ids) through
  the same engine, so web-only clashes are reported by the engine (kind `contribution`) instead of a separate
  `web-contribution` kind. Offline (no console API) the bundled manifests go through the engine too, so offline rows now
  show real dependency statuses for everything the manifests declare (before: everything was `declared`).
- Dependency kinds gained **`plugin`** (`requires: ["plugin:<id>"]`, what Android modules' `dependsOn` map to), shown in
  the Detail → Dependencies tab under "Plugin" and counted in "needs N". `dependents` are de-duplicated per
  (plugin, service).
- Dependency detail wording says "the host" instead of "the console" (the same strings on every port).
- `inventory.py` responses carry `"frame": "plugin-inventory@1"`; the server's `TARGET`/`API_LEVELS` are explicit, and a
  plugin whose `targets` don't include `axf-console` is reported `blocked` with a framework dependency `target axf-console`.
- plugin.json version 0.1.0 → 0.2.0, `builtWith.model` = fable; the web library declares `uiEditor: ['manager']` too.
- Framework `rt.libraries` entries are now `InstalledLibrary` records (id, label, version, template, `dependsOn`,
  `provides`, `uiEditor`, `contributes`, `ui`), built by `installedLibraryRecord` in `framework/react/library.ts`;
  `AxfWebLibrary` gained an optional `uiEditor`.
- Settings library (`framework/libs/settings`) Plugins tab panel "Installed libraries" → "Installed plugins and
  libraries": health chip, "used by N", a Settings button per library with a tab, Details / Open the Plugin Manager when
  that plugin is installed, clash summary.
- Android `lib-settings` `SettingsScreen`: tabs (Appearance, General, Plugins, About; `SettingsTabs`), sub-tab row under
  Plugins (a plugin's own tab id becomes a sub-tab there, never top-level), `InstalledModulesPanel` on the Plugins tab.
- Templates: `react-ts`/`next-ts` `App.tsx` install `libs/settings` through `installLibraries`; `android-compose` App.kt
  adds `PluginManagerModule`, MainActivity registers `settings` and `plugin-manager` views; template.json/READMEs
  document it. Starter assets: every nav-menu (`icon-rail`, `pill-tabs`, `sidebar-list`) and app-menu (`developer`,
  `minimal-picker`, `standard-desktop`) has a **Settings** item; `app.settings` joined `STANDARD_ACTIONS` on the web
  (Kotlin already had it). `spec/fixtures/menu-filter.json` regenerated (the new item only).

## Added
- `framework/core/engines/plugins.ts` (exported from `core/index.ts`): `PluginRecord`, `pluginRecord`,
  `resolveProviders`, `dependenciesOf`, `dependentsOf`, `healthOf`, `conflictsOf`, `inventoryCounts`,
  `buildPluginInventory`, `blockingOf`, `pluginGraph`, constants `PLUGIN_INVENTORY_FRAME`, `PLUGIN_HEALTHS`,
  `PLUGIN_HEALTH_RANK`, `DEPENDENCY_LABEL`, `SCOPE_NOTES`.
- `framework/react/pluginRecords.ts` (exported from `react/index.ts`): `pluginRecordOfLibrary`,
  `pluginRecordsFromRuntime`, `runtimeInventory` — any web app's inventory from `rt.libraries`.
- Kotlin: `axf-kernel/.../plugins/PluginInventoryEngine.kt` (records, context, engine, graph) and
  `PluginInventoryHost.kt` (kernel `ModuleInfo` + loader `PluginInfo` → records; `axf.ui-editor.<kind>` capability
  declares a UI editor); `axf-devtools/.../PluginManagerModule.kt` (+ `PluginManagerService`) and
  `PluginManagerScreen.kt` (4 views × 4 layouts, Compose, theme tokens only, `LifecycleResumeEffect` → reload prefs +
  `refreshFromSaved`).
- Python: the plugin folder’s `server/engine.py`; route `GET /records` (plain records + context).
- Fixture `framework/spec/fixtures/plugin-inventory.json` (generated by `gen-fixtures.mts`: 12 records covering every
  dependency kind and status, every clash kind, the off-provider toggle and the graph), checks
  `framework/spec/check-plugin-inventory.mts` (CI), Kotlin `PluginInventoryConformanceTest`, and the plugin `test.py`
  replay. CI step added to `android.yml`.
- Android console showcase (`apps/console`) and the android-compose template ship the Plugin Manager.

## Contracts, APIs, assets, routes, settings keys, fixtures (old → new)
| What | Old | New |
| --- | --- | --- |
| Model | Python-only `inventory.py` resolver | `plugin-inventory@1` engine, TS = Kotlin = Python, one fixture |
| `GET …/inventory` (the plugin route) | items, services, conflicts, counts | same + `frame`; items also carry `targets`, `serverPart`, `dataDir`, `dataDirProblem` (engine record fields) |
| Conflict kind for web-only clashes | `web-contribution` (id `web:view:x`) | `contribution` (id `contribution:view:x`), resolved by the engine |
| Dependency kinds | framework, service, env, scope, core, other | + `plugin` (`plugin:<id>`) |
| Dependency detail text | "The console runs…" | "The host runs…" (identical across ports) |
| `rt.libraries[]` | `{id,label,version,template?}` | `InstalledLibrary` (superset; old fields unchanged) |
| `STANDARD_ACTIONS` (web) | no `app.settings` | `app.settings` stub (lib-settings registers the handler) |
| Starter nav/app menus | no Settings item | Settings item (`view: settings` / `action: app.settings`) |
| `spec/fixtures/menu-filter.json` | — | regenerated (Settings item) |
| New fixture | — | `spec/fixtures/plugin-inventory.json` |
| New route | — | `GET …/records` next to `/inventory` (plain records + context) |
| Android | no plugin manager | `PluginManagerModule` id `ai.amberx.axf.plugin-manager`, route `plugin-manager`, dialog `plugin-manager.window`, same actions + settings keys as the web plugin |
| Android settings | flat list of groups | tabs + sub-tabs (`SettingsTabs`, `SettingsGroup.tab`), `InstalledModulesPanel` |

**Migration / compatibility.** Apps and plugins using the Opus version need no change: ids, actions, settings keys and
routes are the same; the inventory JSON is a superset. Code that filtered conflicts by kind `web-contribution` should use
`contribution`. Apps that read `rt.libraries` keep working (superset). Existing `axf init` apps don't gain the Settings
nav item until they re-bake assets or add it; new apps get it. An Android app that rendered `SettingsScreen` sees tabs now
(groups without `tab` land in General, except the framework's `appearance`/`about`).

## Tests — before → after
- Opus plugin self-test `test.py`: **46** checks (52 with FastAPI; FastAPI route checks were skipped in this sandbox) →
  **62** checks (plus the 6 route checks when FastAPI is installed, now 7 with `GET /records`). New: fixture replay of
  the Python engine (inventory, off-provider toggle, graph, record fields), target check, `plugin:<id>` dependencies and
  dependents.
- New `framework/spec/check-plugin-inventory.mts` (fixture replay in TS, unit checks: repeated entries count once, a
  plugin never satisfies itself, live-only providers, target `*`, disabled editors don't clash; the web adapter over a real
  runtime with libraries). Passes.
- New Kotlin `PluginInventoryConformanceTest` (frame/healths/labels, full inventory replay, off-provider toggle, graph,
  record-field guard) — **written without a compiler** (Gradle can't reach the plugin portal / Maven from the sandbox);
  CI compiles it.
- Still green: `axf validate --framework` (48 assets), `tracker.mjs --check`, `plugins.mjs --check`,
  `check-theme.mjs` (187 files), `check-project-fixtures.mjs`, `tsc` for the console and `framework/libs`, Vite build of
  the console, `plugin-lifecycle.mjs check plugin-manager` (clean), `axf init` + build of react-ts and next-ts apps.

## Security
- Every Opus guard kept: console token on every plugin route, 404 while disabled, not on MCP, folder pattern, log level
  whitelist, no symlinks followed, env values never serialised, read-only server part, data dir confined to
  `.axf-console/plugins/<folder>`.
- `GET /records` exposes exactly what `/inventory` already did (env set/unset only, no values), under the same guards.
- The Android enable/disable goes through the kernel's `PluginLoader` (placeholder until a platform provides one);
  compiled modules can't be switched off at runtime (no switch shown).

## Known gaps / placeholders
- Kotlin written without a compiler (engine, host, module, screen, settings screen, conformance test); Android
  screenshots pending CI. Compose previews named `PluginManager_<layout>_<view>` are planned, not yet added.
- Android Plugin Manager has no Install view (no plugin catalog on Android yet) and no logs/files tabs (no server part);
  enable/disable needs a platform `PluginLoader` (`axf.plugins` is still a placeholder capability).
- Android `SettingsScreen` sub-tabs come from `SettingsGroup.tab`; a module can't yet declare a `SettingsTab` of its own
  (pass `extraTabs` to `SettingsScreen`).
- The clash list stays read-only (pending item `plugin-conflicts`, parked as unsafe).

## Screenshots (web console; phone = 412×915 @2x, desktop = 1366×860)
The "N keys are needed" / setup banners vary between runs (headless console with no keys) and are not part of the change.

| Screen | Before | After |
| --- | --- | --- |
| Studio · Cards (desktop) | ![before](plugin-manager/shots/before/studio-cards-desktop.png) | ![after](plugin-manager/shots/after/studio-cards-desktop.png) |
| Studio · Cards (phone) | ![before](plugin-manager/shots/before/studio-cards-phone.png) | ![after](plugin-manager/shots/after/studio-cards-phone.png) |
| Studio · Table (desktop) | ![before](plugin-manager/shots/before/studio-table-desktop.png) | ![after](plugin-manager/shots/after/studio-table-desktop.png) |
| Studio · Table (phone) | ![before](plugin-manager/shots/before/studio-table-phone.png) | ![after](plugin-manager/shots/after/studio-table-phone.png) |
| Studio · Detail (desktop) | ![before](plugin-manager/shots/before/studio-detail-desktop.png) | ![after](plugin-manager/shots/after/studio-detail-desktop.png) |
| Studio · Detail (phone) | ![before](plugin-manager/shots/before/studio-detail-phone.png) | ![after](plugin-manager/shots/after/studio-detail-phone.png) |
| Studio · Detail → Dependencies (desktop) | ![before](plugin-manager/shots/before/studio-detail-deps-desktop.png) | ![after](plugin-manager/shots/after/studio-detail-deps-desktop.png) |
| Studio · Detail → Dependencies (phone) | ![before](plugin-manager/shots/before/studio-detail-deps-phone.png) | ![after](plugin-manager/shots/after/studio-detail-deps-phone.png) |
| Studio · Dependencies graph (desktop) | ![before](plugin-manager/shots/before/studio-graph-desktop.png) | ![after](plugin-manager/shots/after/studio-graph-desktop.png) |
| Studio · Dependencies graph (phone) | ![before](plugin-manager/shots/before/studio-graph-phone.png) | ![after](plugin-manager/shots/after/studio-graph-phone.png) |
| Studio · Install (desktop) | ![before](plugin-manager/shots/before/studio-install-desktop.png) | ![after](plugin-manager/shots/after/studio-install-desktop.png) |
| Studio · Install (phone) | ![before](plugin-manager/shots/before/studio-install-phone.png) | ![after](plugin-manager/shots/after/studio-install-phone.png) |
| Mission control · Cards (desktop) | ![before](plugin-manager/shots/before/mission-cards-desktop.png) | ![after](plugin-manager/shots/after/mission-cards-desktop.png) |
| Mission control · Cards (phone) | ![before](plugin-manager/shots/before/mission-cards-phone.png) | ![after](plugin-manager/shots/after/mission-cards-phone.png) |
| Mission control · Dependencies (desktop) | ![before](plugin-manager/shots/before/mission-graph-desktop.png) | ![after](plugin-manager/shots/after/mission-graph-desktop.png) |
| Mission control · Dependencies (phone) | ![before](plugin-manager/shots/before/mission-graph-phone.png) | ![after](plugin-manager/shots/after/mission-graph-phone.png) |
| Terminal · Table + `deps agent-manager` (desktop) | ![before](plugin-manager/shots/before/terminal-table-desktop.png) | ![after](plugin-manager/shots/after/terminal-table-desktop.png) |
| Terminal · Table (phone) | ![before](plugin-manager/shots/before/terminal-table-phone.png) | ![after](plugin-manager/shots/after/terminal-table-phone.png) |
| Terminal · Detail (desktop) | ![before](plugin-manager/shots/before/terminal-detail-desktop.png) | ![after](plugin-manager/shots/after/terminal-detail-desktop.png) |
| Terminal · Detail (phone) | ![before](plugin-manager/shots/before/terminal-detail-phone.png) | ![after](plugin-manager/shots/after/terminal-detail-phone.png) |
| Catalog · Cards (desktop) | ![before](plugin-manager/shots/before/catalog-cards-desktop.png) | ![after](plugin-manager/shots/after/catalog-cards-desktop.png) |
| Catalog · Cards (phone) | ![before](plugin-manager/shots/before/catalog-cards-phone.png) | ![after](plugin-manager/shots/after/catalog-cards-phone.png) |
| Catalog · Install (desktop) | ![before](plugin-manager/shots/before/catalog-install-desktop.png) | ![after](plugin-manager/shots/after/catalog-install-desktop.png) |
| Catalog · Install (phone) | ![before](plugin-manager/shots/before/catalog-install-phone.png) | ![after](plugin-manager/shots/after/catalog-install-phone.png) |
| Settings → Plugins → Plugin Manager (desktop) | ![before](plugin-manager/shots/before/settings-tab-desktop.png) | ![after](plugin-manager/shots/after/settings-tab-desktop.png) |
| Settings → Plugins → Plugin Manager (phone) | ![before](plugin-manager/shots/before/settings-tab-phone.png) | ![after](plugin-manager/shots/after/settings-tab-phone.png) |
| Settings → Plugins → All plugins (desktop, full page) | ![before](plugin-manager/shots/before/settings-all-plugins-desktop.png) | ![after](plugin-manager/shots/after/settings-all-plugins-desktop.png) |
| Settings → Plugins → All plugins (phone, full page) | ![before](plugin-manager/shots/before/settings-all-plugins-phone.png) | ![after](plugin-manager/shots/after/settings-all-plugins-phone.png) |

Android screens affected (screenshots pending CI): Plugin Manager (Studio / Mission control / Terminal / Catalog ×
Cards / Table / Detail / Dependencies), Plugin Manager window dialog, Settings (tabs + Plugins sub-tabs), Settings →
Plugins → Installed modules, Settings → Plugins → Plugin Manager group, the default context menu (Plugin Manager link).
