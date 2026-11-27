# Plugin removal check 09: plugin tools

Step s9 of `emergency-check-can-these-plugins-`. Report only: nothing deleted, nothing changed.
Audited: `plugin-manager`, `plugin-update`, `plugins-menu` (all under `apps/console-web/plugins/`).

## Verdicts

| Plugin | Verdict | What depends on it (outside its folder) | What to move, and where |
|---|---|---|---|
| `plugin-manager` | **MOVE FIRST** | **1. Lazy loader store.** The console shell reads and writes its lazy-loader config through this plugin's routes: `apps/console-web/src/pluginLoader.tsx:508` (`POST /api/plugins/plugin-manager/lazy/report`) and `:515` (`GET /api/plugins/plugin-manager/lazy`). `apps/console-web/scripts/lazy-loader-check.mts:74` imports the plugin's `server/lazy.py` directly, and `:27`, `:37`, `:89`, `:101` assert on the folder. `apps/console-web/src/lazyEngine.ts:43` lists it in `CORE_PLUGINS` (must equal the plugins declaring `lazy.core`; `plugin.json:4` declares it). `framework/schemas/settings-sources.json:100` registers `plugin:plugin-manager` as one of the two stores of the lazy defaults (checked in CI by `check-settings-sources`). **2. Inventory and logs for every plugin's settings tab.** `apps/console-web/src/PluginDefaultSettingsTab.tsx:27-46` finds the plugin by `view:plugin-manager` and calls its `/inventory` and `/logs/<folder>` routes; that tab is wrapped round every plugin (`apps/console-web/src/App.tsx:40`). **3. The Python port of `plugin-inventory@1`.** `server/engine.py` is the third port named in `framework/core/engines/plugins.ts:6`, `framework/spec/PORTING.md:12` and `_claude/rules/RULES.md:17`; only the plugin's own `test.py` replays `framework/spec/fixtures/plugin-inventory.json` against it. **4. Soft links with a fallback** (need no move): `apps/console-web/src/consoleSearch.ts:65`, `apps/console-web/src/menuLibrary.tsx:199-203` and `:235`, `framework/libs/settings/index.tsx:369-387`, `PluginDefaultSettingsTab.tsx:92`, `plugins-menu/web/index.tsx:82-83`. **5. Other plugins with no fallback:** `ref-links/refs.mjs:64` (every plugin reference opens `plugin-manager.open:<folder>`), `ai-assistant/web/voicemic.tsx:13`, `fable-rebuilds/web/index.tsx:37` and `web/ui.tsx:77`. | **a.** `server/lazy.py` plus the six `/lazy*` routes → console server core (`apps/console-web/server/`, e.g. `/api/plugin-lazy`); repoint `pluginLoader.tsx:508,515`, `lazy-loader-check.mts:74` and `settings-sources.json:100`. **b.** `web/LazyLoader.tsx` (the only screen that edits the lazy loader) → a panel on Settings → Plugins in `apps/console-web/src/`. **c.** `server/engine.py` + `server/inventory.py` + the `/inventory`, `/logs`, `/records`, `/plugin` routes → console server core (e.g. `/api/plugin-inventory`), with the fixture replay from `test.py` moved to a server test; repoint `PluginDefaultSettingsTab.tsx:27-46`. **d.** Drop `plugin-manager` from `CORE_PLUGINS` (`lazyEngine.ts:43`) and from `lazy-loader-check.mts:27,37,101` in the same change. **e.** `ref-links/refs.mjs:64` needs the `settings.open:plugins` fallback the shell already uses (or goes with `ref-links`, also on the list). |
| `plugin-update` | **SAFE** | Nothing kept imports it, calls a route of it (it has no server part) or reads its data. The confirmed swap is not in the plugin: the route is `apps/console-web/server/main.py:1588` (`POST /api/plugin-catalog/swap`) and the logic is `framework/cli/plugin-catalog.mjs:448` (`swap`); `framework/cli/plugin-instances.mjs:10` mentions Plugin Update in a comment only. Leftover names, data only: `framework/core/engines/embed.ts:181` (`plugin-update.` prefix), `apps/console-web/src/assets/help/console.json:234`, `framework/spec/token-manifest-baseline.json:10`, `framework/spec/DESIGN-LANGUAGE.md:149`. | Nothing has to move. Cost: its page is the **only screen** that calls Update, Replace (swap) and "Rebuild with <model>" (`plugin-update/web/index.tsx:82`, `:93`, `:104`). After removal those work from the CLI and the API only. If Replace should stay on a screen, put a Replace button on the shared Install & uninstall panel (`apps/console-web/src/pluginLifecycle.tsx`). |
| `plugins-menu` | **SAFE** | Nothing kept imports it or calls its routes (`/api/plugins/plugins-menu/*` has no caller outside the folder). One hard name: `apps/console-web/src/lazyEngine.ts:56` lists it in `KNOWN_BANNERS`, and `apps/console-web/scripts/lazy-loader-check.mts:86` fails when a listed plugin no longer exists. Leftover names, data only: `framework/core/engines/embed.ts:181` (`plugins-menu.` prefix), `framework/spec/check-settings-open.mts:45` (a sample dialog id string), `framework/spec/chrome-baseline.json:15`, `framework/spec/token-manifest-baseline.json:10`, `framework/spec/fixtures/page-toolbar-voice.json` (9 lines), `ai-assistant/web/voicemic.tsx:12`. | Nothing has to move. Remove the `KNOWN_BANNERS` entry in the same change. Cost: it is the **only** installer for archive locations other than axHub (folders, https servers, other consoles: `plugins-menu/server/__init__.py:414-618`), and it owns the right-click Plugins submenu, the app menu "All plugins" ladder, the plugin settings browser dialog and the off-plugin badges. Those features end with it. |

## Evidence

### Checked and clean for all three

- `node framework/cli/plugin-lifecycle.mjs check <folder>`: clean for all three (no stale references, install and uninstall scripts present).
- `apps/console-web/server/`: no reference to any of the three names. Enable, disable, install and uninstall run on the console's own routes (`/api/plugins/<folder>/enabled`, `/api/plugin-lifecycle/*`, `/api/plugin-catalog/*`).
- The shared Install & uninstall panel is `apps/console-web/src/pluginLifecycle.tsx` (`:30` calls `/api/plugin-lifecycle/`). It is shell code, not part of any of the three plugins; all three only import it.
- Settings → Plugins → All plugins is `framework/libs/settings/index.tsx:365` (`LibrariesPanel`), driven by the TypeScript engine `framework/core/engines/plugins.ts`. It stays without any of the three.
- `deploy/`, `services/axf-data`, `.github/workflows`: no reference to any of the three. CI finds plugin tests by glob (`.github/workflows/android.yml:460-470`), so removing a folder does not break those steps.
- Postgres: no table belongs to any of the three. `framework/spec/DATA-INVENTORY.md:129` and `:160` are planning rows only.
- Other apps: `apps/expenses/src/plugins/plugin-manager/` is Expenses' own code with the same name (`framework/cli/plugin-lifecycle.mjs:171` says so). The Android `PluginManagerModule.kt` and `PluginManagerScreen.kt` are separate Kotlin and unaffected.
- No other plugin's `plugin.json` requires a capability of the three.

### plugin-manager

- Manifest: provides `view:plugin-manager`, `dialog:plugin-manager.window`, `action:plugin-manager.open`, `action:plugin-manager.window`, `context-menu:default/plugin-manager`, `settings-tab:plugin-manager`. Scopes `ROUTES`, `MENU_ITEMS`, `SETTINGS`. Declares `lazy.core: open`, which makes it one of four plugins the loader refuses to switch off.
- Routes under `/api/plugins/plugin-manager/`: `/inventory`, `/records`, `/plugin/{folder}`, `/logs/{folder}`, `/lazy` (GET, PUT), `/lazy/plugin/{folder}`, `/lazy/reset`, `/lazy/report` (`server/__init__.py:59-145`).
- Data: `/opt/axf/.axf-console/plugins/plugin-manager/lazy-report.json` exists and was written today (13.6 kB), so the live console is using the lazy routes now. No `lazy.json` is saved, so the loader runs on defaults.
- What breaks if it is removed without the moves:
  - The loader keeps working on its cached or default config (`pluginLoader.tsx:512` handles a missing plugin), but nothing can change the lazy config any more: no screen, no REST, no MCP, no CLI.
  - `lazy-loader-check.mts` fails at `:74` (missing `lazy.py`), `:27`, `:89` and `:101`. This check is not in `.github/workflows`; it is a manual check listed in `_claude/THREADS.md:368`.
  - `check-settings-sources` (CI, `android.yml:100` and `:198`) reads `settings-sources.json:100`, which names the plugin as a store.
  - Every plugin's settings tab loses its info, dependency and log sections and shows "Info and logs come from the Plugin Manager's server part, which is off or not answering" (`PluginDefaultSettingsTab.tsx:95`).
  - The Python port of `plugin-inventory@1` goes, with the only test that replays the shared fixture against it.
- Generated files to refresh in the removal change: `framework/spec/chrome-baseline.json:13-14`, `framework/spec/json-data-writes.baseline.json:47`, `framework/spec/token-manifest-baseline.json:10`, `framework/spec/fixtures/page-toolbar-voice.json` (regenerate with `check-page-toolbar-voice.mts --write`), help entries `apps/console-web/src/assets/help/console.json:227`, `:1112`, `:1272`, and the glossary catalog.
- Left alone on purpose: `framework/core/engines/embed.ts:181`, Kotlin `EmbedTakes.kt:82-84`, `framework/spec/fixtures/embed-takes.json`, `framework/spec/fixtures/refs.json:127,320` and `framework/spec/check-embed.mts:231-262` use the action names as plain strings and register their own test action. They pass without the plugin; changing them means regenerating cross-port fixtures.
- Doc lines carrying `axf-plugin:plugin-manager` are removed by `uninstall.mjs --all`: `_claude/memory/STATUS.md:67`, `_claude/memory/decisions.md:58`, `_claude/THREADS.md:368-369`, `apps/console-web/plugins/README.md:47`, `_claude/memory/docs/rebuilds/plugin-manager.md:28`. `_claude/rules/RULES.md:17` has no marker and needs a hand edit, since it names this plugin as the console's plugin manager.

### plugin-update

- Manifest: provides `view:plugin-update`, `settings-tab:plugin-update`, `action:plugin-update.open`. No scopes, no server part, no env. `dataDir` `.axf-console/plugins/plugin-update` does not exist on the live console.
- It calls only core routes: `GET /api/plugins`, `GET /api/plugin-catalog`, `POST /api/plugin-catalog/install` (`web/index.tsx:82`), `POST /api/plugin-catalog/swap` (`:93`), `POST /api/pending` (`:104`).
- The swap route has its own server test that does not use the plugin: `apps/console-web/server/test_plugin_catalog.py:60-61`.
- Doc lines carrying its marker: `_claude/memory/STATUS.md:148`.

### plugins-menu

- Manifest: provides `dialog:plugins-menu.settings`, `dialog:plugins-menu.install`, `settings-tab:plugins-menu`, `action:plugins-menu.settings`, `action:plugins-menu.install`. Scope `ROUTES`. Env `AXF_PLUGINS_MENU_DIR`, read only by its own server part (`server/__init__.py:96`).
- Routes under `/api/plugins/plugins-menu/`: `/archives` (GET, POST, DELETE), `/archives/{id}/test`, `/browse`, `/item`, `/install`, `/config` (GET, PUT).
- Data: `.axf-console/plugins/plugins-menu` does not exist on the live console, so no archive location or credential has ever been saved. Nothing is lost by removing the data folder.
- It depends on `plugin-manager` only through the capability `view:plugin-manager` and falls back to `settings.open:plugins` (`web/index.tsx:82-83`), so the two can be removed in either order.
- Doc lines carrying its marker: `_claude/memory/STATUS.md:149`, `apps/console-web/plugins/README.md:130`.

## If all three are removed

No screen is left that installs a plugin from the catalog. The three installers are `plugin-manager/web/InstallView.tsx:66`, `plugin-update/web/index.tsx:82` and `plugins-menu/web/index.tsx:399`. Install, update and swap would work from `framework/cli/plugin-catalog.mjs` and the `/api/plugin-catalog/*` routes only. If a catalog install screen should stay, move `InstallView.tsx` to Settings → Plugins along with the lazy loader panel.

## Recommendation

Remove `plugin-update` and `plugins-menu` whenever the removal build runs. Hold `plugin-manager` until moves a to d are done; if those moves are not wanted, treat it as KEEP.
