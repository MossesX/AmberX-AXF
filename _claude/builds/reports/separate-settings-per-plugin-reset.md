# Separate settings per plugin + reset confirm dialog

Build `separate-settings-per-plugin-reset` · branch `claude/separate-settings-per-plugin-reset` · PR #814 · 2026-11-17

Brett said (2026-11-17 18:56):

> Each plugin needs its own settings interface, not the console's. Reset asks in a confirm dialog with a switch to include
> assets and a scrollable table of changed assets. Make sure every page has the correct default settings interface.

## Result

- **Every plugin opens its own settings window.** `PluginSettingsWindow` (framework/react) renders one plugin's
  interface: its `settings/plugin-<id>` asset, or the default the plugin-settings@1 engine generates. It shows only that
  plugin's tabs and keys and keeps the level toolbar. Every opener lands there: the screen gear, `plugin.settings.open`,
  Plugin Manager, the plugins menu, right-click Settings…, home cards, banner chips, systems check, and any
  `settings.open:<plugin tab>` (the settings-open engine now routes a plugin's tab to its window). The console's
  Settings no longer renders any plugin tab.
- **Settings → Plugins is a list.** It has one row per plugin, and each row opens that plugin's own window. The console
  still registers plugin tabs under `parent: 'plugins'` (for discovery only) and stamps `plugin: <id>` on each.
- **Reset asks first.** `ResetConfirmDialog` (framework/react) has:
  - the plan's summary line;
  - an **Include assets** switch, off by default;
  - a **scrollable table** of what changes. Settings it clears come first; changed assets and skins are greyed and
    marked "kept" while the switch is off. The table is the settings panel's `ChangedAssetsTable` (lib-datagrid), which
    Settings → Appearance → Changed here also uses;
  - Reset (danger, disabled when there is nothing to reset) and Cancel, in a labelled `role="toolbar"`.

  With the switch off, only the scope's settings are cleared. With it on, the scope's look keys are cleared too, and
  the look goes back through the existing skin Restore to default path (`skin.restore:app` with a Skins plugin, else
  `restoreDefaultAppearance`). For a plugin, its skin scope goes back to inherit. One undo (`settings.reset.undo`).
- **Every page has its correct default.** All 73 plugins ship `settings/plugin-<id>` and name it in `plugin.json`
  (`settingsInterface`). The 50 plugin pages resolve to their plugin's own interface and the 16 console pages to
  `settings/console`. console-web, axhub-web, amberx-droid and molly each pick an app interface. `settings.here` opens
  the current page's own interface. `check-settings-interfaces.mjs` holds all of this in CI with a ratchet at 0.

## How each feature is reached

| Feature | UI | REST | MCP | CLI | Voice (AmberX) |
| --- | --- | --- | --- | --- | --- |
| Open a plugin's own settings | gear on its screen, Settings → Plugins row, Plugin Manager, right-click Settings… | `POST /api/console-control/plugins/<id>/settings/open`; `console.settingsinterfaces` act open | `console_control_plugin_settings {plugin, open: true}`; `console_open` settings `plugin/<id>` (deep link `settings:plugin/<id>`) | `axf settings open <plugin>` | "open <plugin> settings" |
| Read an interface (resolved, values, changed assets) | the window itself | `GET /api/settings/interfaces/<owner>` (live from the open console; with none open, from the plugin's asset file, `live: false`) | `settings_interface_get {owner}`; control@1 `console.settingsinterfaces` get | `axf settings get <owner> [--json]` | (state reads go through MCP/REST) |
| Open the reset dialog | Reset… on Settings, every settings tab dialog, every plugin window; Appearance Restore…; skin picker Reset…; right-click Restore to default; About → Reset assets… | `console.settingsinterfaces` act reset.ask | `console_dialog` `settings-reset` (deep link `dialog:settings-reset?scope=<id>`) | `axf settings reset <owner> --ask` | "reset settings" / "reset <plugin> settings" |
| Reset (dry run = the changed-assets table) | the dialog's Reset | `POST /api/settings/reset {scope, includeAssets, dryRun}`: dryRun returns the plan and a confirm token; without a valid token, 428 with the plan; with it, the reset runs | `settings_reset {scope, include_assets, dry_run=true}`, then again with `dry_run=false, confirm=<token>` | `axf settings reset <owner> [--include-assets] [--dry-run]`, then `--confirm <token>` | opens the dialog; the reset itself is a tap |
| Undo the last reset | Settings → Appearance Undo | console action `settings.reset.undo`; `console.settingsinterfaces` act undo | `console_action settings.reset.undo` | `axf settings undo` | "press undo the last settings reset" |
| Settings for this page | (menu / search: Settings for this page) | console action `settings.here` | `console_action settings.here` | `axf console action settings.here` | "press settings for this page" |

Destructive presses need confirmation everywhere: the dialog in the UI, the confirm token over REST, MCP and the CLI,
and the console relay's own confirm. Opening the dialog or a window counts as navigation (`allow`), never a veto.

## Files

- framework/react: `components/PluginSettingsWindow.tsx`, `components/ResetConfirmDialog.tsx`, exports in `index.ts`;
  `ui/axf.css` (reset dialog, tokens only).
- framework/libs/settings: `reset.tsx` (askReset / runSettingsReset / undo / API reads), `changed.tsx`
  (ChangedAssetsTable, resetStateOf), `index.tsx` (window and dialog registration, the Plugins list, Reset buttons, the
  plugin-tab filter).
- framework/core/engines: `settingsopen.ts` (plugin tab → its window), `control-rules.mjs` (appended
  `console.settingsinterfaces`), `console-control-voice.mjs` (reset intents), `settings-reset.ts` (two strict-index
  fixes; look-key pattern for dotted plugin ids).
- Console: `pluginSettingsActions.ts`, `PluginSettingsGear.tsx`, `App.tsx`, `main.tsx` (loads plugin interfaces),
  `control/actions.ts`, plugins `console-commands` (deep links, data acks, control target), `plugins-menu`, every
  plugin's `plugin.json` + `assets/settings/plugin-<id>.json`.
- Server: `settings_api.py` (new), `main.py`, `console_control.py`, `console_control_api.py`, `mcp_server.py`.
- CLI: `framework/cli/settings.mjs` (new, `axf settings`), `framework/cli/check-settings-interfaces.mjs` (new),
  `axf.mjs`.
- Tests: `framework/spec/plugin-settings-reset.test.mts`, `apps/console-web/server/tests/test_settings_api.py`, updated
  `test_console_control.py`, `scripts/plugin-gear.e2e.mjs`, `check-control.mts`. All are in CI.
- Docs: `framework/spec/CONTROL.md`, `PLUGIN-SETTINGS.md`, `plugin.schema.json` (`settingsInterface`), glossary terms,
  help entries.

## Checks run (all pass on the merged branch)

validate (framework + console-web), tracker --check, check-theme, check-controls, check-toolbars, check-chrome-assets,
check-console-control (cli + spec), check-settings-interfaces (0, baseline 0), check-plugin-settings (cli + spec),
check-settings-reset, check-settings-open, check-control, shared-assets check, chrome-settings check, the new engine test,
the settings API, console-control, MCP and console-commands server tests, and a fresh-bake `tsc --noEmit` of the console.

## UI Review

Item `r-20261117-cirmv01` covers Maintenance's own settings window, with three options for the level its interface
opens at: Basic with descriptions (the generated default), Simple and compact, and Developer with everything. The
option assets are in `plugins/maintenance/assets/settings/`. Shots of the reset dialog (switch off, on, table scrolled;
desktop and phone) are in UI Review → Screenshots, group "Separate settings per plugin + reset confirm dialog".

## Notes and decisions

- The table is a lib-datagrid `DataGrid`, but framework/react never imports a library. The settings library hands the
  table to the dialog through `setResetTableRenderer`; without it the framework table (`.fx-table`) draws the same rows.
  The window's bodies come in the same way (`setPluginSettingsRenderer`).
- **Engine bug found by the new test.** The look-key pattern `axf.plugin.[^.]+.look` missed dotted plugin ids
  (`ai.amberx…`), so a reset with the switch off would have cleared a plugin's look. Fixed; fixture regenerated.
- **Found in the screenshots.**
  - The reset listed unregistered bookkeeping keys (`axf.skin.migrated`). The reset state now holds only registered
    settings and look keys.
  - A lazily loaded plugin's window was empty until its chunk loaded. Opening now loads the plugin.
- **Level editor.** Its "Reset mine" only forgets the user's own level edits and is not a settings reset, so it does
  not go through the dialog.
- **One Banners settings.** Banners still shows every banner plugin's own settings inside it (Oct 22 rule). A banner
  plugin's gear and chips now open its own window.
- **Not touched.**
  - `plugins/plugin-manager/assets/settings/plugin-screen-settings-*` (UI Review choice assets from an earlier build)
    use the now-reserved `plugin-` prefix. They are never loaded (the console loads only scope-plugin interfaces), but a
    later rename would tidy them.
  - The glossary test's description ratchet already fails on the base commit (392 generic entries against 388) and is
    not touched here.
- **Kotlin.** No Kotlin twin for the window or dialog. The engines' twins are already recorded as deferred gaps in
  PORTING.md.
