# Plugin removal check 08: skins and designers

Build `emergency-check-can-these-plugins-`, step s8. Report only: nothing was deleted or changed.

Plugins audited: `skin-editor`, `skin-gallery`, `context-menu-designer`, `basic-filter`
(`apps/console-web/plugins/<plugin>/`).

## Result

All four are **SAFE**. No kept code imports them, calls their routes, dispatches their actions or reads their
data. Three of them leave a baseline or seed-list entry behind that a check rejects, so each removal carries a
small list of edits that must land in the same PR.

| Plugin | Verdict | What depends on it | What to move / fix in the removal PR |
| --- | --- | --- | --- |
| `skin-editor` | **SAFE** | Nothing kept. The engine it sits on (`framework/core/engines/token-registry.mjs`, incl. `SKIN_VARS_KEY` `:48` and `SKIN_VOICE_FRAME` `:465`) is framework code with its own CLI (`framework/cli/token-registry.mjs:27`) and CI check (`framework/spec/check-token-registry.mjs`); it stays. | Nothing to move. Regenerate `framework/spec/fixtures/page-toolbar-voice.json` (rows `:876-913`, toolbars `skin-editor` and `token-registry`). Update the feature note that names the plugin: `framework/catalog/status.json:2350`, `framework/catalog/catalog.json:355`, `framework/plan/plan.json:4502,4528`, `tracker.json:497`. Optional: `framework/spec/DATA-INVENTORY.md:160`, `framework/spec/json-data-writes.baseline.json:53` (ratchet, a stale line is allowed). |
| `skin-gallery` | **SAFE** | One soft user: Settings → Appearance (`framework/libs/settings/index.tsx:640-644`, `:681`) routes Use / Back / Restore / Undo through the `axf.skin-switch@1` capability when a library provides it, and falls back to the runtime's own `rt.useSkin / backToSkin / restoreDefaultAppearance / undoRestoreDefault` when none does. The "Open Skins gallery" button (`:681`) is only drawn when the service exists. | Nothing to move. **Required:** drop `'skin-gallery'` from `KNOWN_BANNERS` (`apps/console-web/src/lazyEngine.ts:57`); `apps/console-web/scripts/lazy-loader-check.mts:86` fails on a name with no plugin folder. Regenerate `framework/spec/fixtures/page-toolbar-voice.json` (rows `:918-942`). Optional: writers list in `framework/spec/fixtures/data-store-migration.json:243`, `framework/spec/json-data-writes.baseline.json:54`, `_claude/THREADS.md:100`. |
| `context-menu-designer` | **SAFE** | Nothing kept. Its `ctxd-<id>` context-menu assets and the `axp-ctxd-live` stylesheet are registered at runtime from its own store (`web/store.ts`); no other file names `ctxd`. No designs exist on the live console, so no app has a `ctxd-` menu active. | Nothing to move. **Required:** drop it from `framework/spec/token-manifest-baseline.json:8` (`framework/cli/token-registry.mjs:260` fails on an exempt name with no folder). Regenerate `framework/spec/fixtures/page-toolbar-voice.json` (rows `:358-361`, toolbar `context-menu-actions`). Remove the help entry `apps/console-web/src/assets/help/console.json:294` and its source `_claude/builds/help-src/console.py:53`. Marked doc lines (`_claude/memory/STATUS.md:156`, `apps/console-web/plugins/README.md:71`) are stripped by `uninstall.mjs --all`. |
| `basic-filter` | **SAFE** | Nothing kept. It fills two slots owned by others: `axf.dataset.toolbar` (`framework/libs/datagrid/datasets.ts:17`, drawn at `framework/libs/datagrid/index.tsx:239`) and `plugin-switches.row` (`apps/console-web/plugins/plugin-switches/web/index.tsx:28`). Both render nothing when no plugin fills them. Only other mention in code is a build-step label in `apps/console-web/plugins/feature-matrix/web/plain.ts:76` (not an import; `feature-matrix` is on the removal list too). | Nothing to move. **Required:** drop it from `framework/spec/token-manifest-baseline.json:6` (`framework/cli/token-registry.mjs:260`) and from `framework/spec/toolbar-page-baseline.json:4` (`framework/cli/check-toolbars.mjs:162`, CI `android.yml:194`). Marked doc lines (`_claude/memory/STATUS.md:80`, `apps/console-web/plugins/README.md:66`) are stripped by `uninstall.mjs --all`. |

## What goes away with each (so nobody is surprised)

- **skin-editor**: the Skin editor and Token registry screens (nav Design, Plugins menu, Framework menu), 16 REST /
  MCP / CLI commands (`skin-editor_registry … _voice`), the Python twin of the snapshot engine
  (`server/__init__.py`, 31 kB). The token registry stays readable through `node framework/cli/token-registry.mjs`.
  There is no other screen that browses tokens or edits a skin with snapshots.
- **skin-gallery**: the Skins screen, the banner chip, the "Change skin here…" right-click entries, 12 REST / MCP /
  CLI commands (`skin-gallery_list … _set-settings`), and its wrapper CLI `skin-gallery.mjs`. Switching a skin stays
  possible from Settings → Appearance and `node framework/cli/skins.mjs`. Switching at **hub / screen / plugin scope
  from a screen** has no other UI; `framework/core/engines/skin-switch.mjs` then has no caller except its check
  (`framework/spec/check-skin-switch.mts`, CI `android.yml:358`).
- **context-menu-designer**: the designer screen, the Actions window, "Design this menu…" on every right-click, the
  View menu entry. The framework's own context-menu assets are untouched.
- **basic-filter**: the Sort & filter dialog and its toolbar above attached grids. Grids keep their built-in column
  sorting; any dataset it was attached to simply loses the extra toolbar.

## Evidence

Method: read each `plugin.json`, `web/index.tsx`, `web/menu.ts`, `hooks.mjs` and server module; `git grep` over the
whole repo outside each folder for the folder name, plugin id, snake_case form, actions, views, capabilities, setting
keys, env vars, asset prefixes and route prefixes; `node framework/cli/plugin-lifecycle.mjs status|check <folder>`;
read-only look at the live data folders under `/opt/axf/.axf-console/plugins/`.

**Manifests**

| | skin-editor | skin-gallery | context-menu-designer | basic-filter |
| --- | --- | --- | --- | --- |
| uiEditor | theme, style | theme | none | none |
| provides | 2 views, settings tab, 3 actions | view, settings tab, runtime capability `axf.skin-switch@1` (`web/index.tsx`) | view, settings tab | dialog, settings tab, 2 slots |
| commands | 16 declared (auto) | 12 declared (auto) | auto only | auto only |
| server routes | `/api/plugins/skin-editor/*` | `/api/plugins/skin-gallery/*` (shells out to `skin-gallery.mjs`) | `/api/plugins/context-menu-designer/designs` | none (web only) |
| nav / menus | Design nav (2), Plugins menu (2), Framework menu (2) | Design nav, Plugins menu, banner chip | Design nav, Plugins menu, View menu | Plugins menu, View menu |
| context menu | none | canvas: 2 entries; chip: 3 entries | default target: "Design this menu…" | none |
| settings tab | Settings → Plugins → Skin editor | Settings → Plugins → Skins | Settings → Plugins → Context menu designer | Settings → Plugins → Basic filter |
| dataDir | `.axf-console/plugins/skin-editor` (env `AXF_SKIN_EDITOR_DIR`) | `.axf-console/plugins/skin-gallery` | `.axf-console/plugins/context-menu-designer` (env `AXF_CONTEXT_MENU_DESIGNER_DIR`) | `.axf-console/plugins/basic-filter` |
| setting keys | `axf.skin-editor.level / .ui / .element / .panel` | server-side settings file only | none | `basic-filter.toolbar / .datasets / .state` |

**Searches that came back empty outside the plugin folders** (history folders `_claude/builds/shipped`,
`_claude/builds/reports`, `changes/`, `sessions/` excluded):

- `deploy/`, `services/` (incl. `services/axf-data`), `.github/workflows`, root `CLAUDE.md`, `_claude/rules`,
  `_claude/shared`: no mention of any of the four, in dashed or snake_case form.
- Actions `skin-editor.open / .pick / .load`, `token-registry.open`, `nav:token-registry`, `skin-gallery.focus`,
  `context-menu-designer.open / .actions / .filter`, `basic-filter.open`: no caller outside the owning plugin.
- Setting keys `basic-filter.*` and `axf.skin-editor.level / .ui / .element / .panel`: no reader outside the owning
  plugin. (`axf.skin-editor.vars` is a framework key defined in the engine, not the plugin; it stays.)
- Env vars `AXF_SKIN_EDITOR_DIR`, `AXF_CONTEXT_MENU_DESIGNER_DIR`: only read by the plugins' own servers.
- Postgres: no table belongs to any of them. `framework/schemas/data-store*.json` does not name them;
  `framework/spec/DATA-INVENTORY.md:160` only lists `skin-editor` among small folders that map to generic
  `plugin_settings` rows.
- AmberX app / other apps: no reference. Voice and MCP reach these plugins only through the generic plugin-commands
  layer, which lists whatever plugins exist.

**Loading and CI are by glob, not by name.** The console bundles plugins through `import.meta.glob`
(`apps/console-web/src/pluginLoader.tsx:34`, `src/plugins.ts:64`, `src/main.tsx:27-37`); CI runs plugin tests by glob
(`.github/workflows/android.yml:460-474`, "so removing a plugin never breaks CI"). `menu-reach.mts:101` and
`check-help.mts:125` walk the plugins folder.

**Lifecycle check.** `plugin-lifecycle.mjs check` reports `clean` for all four: no stale references. Managed doc
lines exist only for `context-menu-designer` and `basic-filter` (listed in the table). `CLAUDE.md` is listed in three
manifests' `mentions` but holds no line for any of them.

**Live data on the console (read-only look, Nov 27 2026)**

| Plugin | Live data folder |
| --- | --- |
| skin-editor | 16 kB: `current.json` and one session (`sessions/view_build-orchestrator.json`). No exported skins. |
| skin-gallery | none |
| context-menu-designer | none (no saved designs) |
| basic-filter | none (by design; its values are app settings) |

## Notes for whoever runs the removal

1. **Every plugin that declares a theme editor is on the removal list.** `uiEditor: theme` is declared by
   `skin-editor`, `skin-gallery`, `theme-editor`, `theme-manager` and `claude-handoff`, and by nothing else under
   `apps/console-web/plugins/`. After all five go, the look is editable only through Settings → Appearance and the
   framework's `lib-plugintheme` (`framework/libs/plugintheme/index.tsx:410`). No check requires a plugin theme
   editor (`framework/core/engines/plugins.ts:254` only counts them), so this is a product decision, not a blocker.
   Decide it before removing the last one.
2. **`skin-gallery` replaces four framework actions while it is loaded.** It registers `skin.use`, `skin.restore`,
   `skin.undo` and `skin.scope` (`web/actions.ts`) over the runtime's own handlers of the same names
   (`framework/core/runtime.ts:3252-3276`; the registry is last-write-wins, `framework/core/engines/actions.ts:49`).
   Removing it hands those ids back to the framework, including `skin.use:next / prev` used by the app menu
   (`apps/console-web/src/assets/app-menu/default-console-web-appmenu.json:520,528`) and the search toolbar
   (`apps/console-web/src/assets/toolbar/console-search.json:66`). Expected to be an improvement, not verified in a
   browser.
3. **Open UI Review items.** The live UI Review store holds 5 pending items for `skin-editor` and 2 pending (1
   approved) for `skin-gallery`, plus option assets for the gallery layout and banner chip choices. Close or drop
   them when the plugins go, or they will point at screens that no longer exist.
4. **Not verified:** which datasets `basic-filter` is attached to on Brett's console. The attach list is an app
   setting (`basic-filter.datasets`) that is not in any file under `.axf-console/`. It does not change the verdict:
   detaching is what removal does.
5. Use each plugin's `uninstall.mjs --all` so data, state and marked doc lines go together, then make the
   "Required" edits in the table and run `node framework/spec/check-token-registry.mjs`,
   `node framework/cli/check-toolbars.mjs`, `npx -y tsx framework/spec/check-page-toolbar-voice.mts --write` and
   `npx -y tsx apps/console-web/scripts/lazy-loader-check.mts`.
