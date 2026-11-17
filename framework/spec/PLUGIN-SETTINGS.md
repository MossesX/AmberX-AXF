# Plugin settings interfaces (plugin-settings@1) and the reset plan (settings-reset@1)

Brett, Nov 17 2026: "Each plugin needs its own settings interface, not the console's. Reset asks in a confirm dialog
with a switch to include assets and a scrollable table of changed assets. Make sure every page has the correct default
settings interface."

This file is the contract. The reference engines are `framework/core/engines/plugin-settings.ts` (which interface a
page renders through) and `framework/core/engines/settings-reset.ts` (what a reset clears); their fixtures are
`framework/spec/fixtures/plugin-settings.json` and `framework/spec/fixtures/settings-reset.json`. The Kotlin twins are
deferred gaps in `PORTING.md`.

## 1. One interface per owner

A settings interface is a `settings` asset (settings-ui@1, `core/engines/settingsui.ts`). Every interface has exactly
one **owner**, named by the asset's `data.scope`:

| `scope` | Owner | Asset id | Who renders through it |
| --- | --- | --- | --- |
| `app` | the app's own settings page | the app's pick (the Dev Console's is `settings/console`) | the app's Settings dialog and every console page that is not a plugin's |
| `plugin` | one plugin, `data.owner` = its plugin id | `settings/plugin-<owner>` | that plugin's Settings → Plugins sub-tab, its screen's settings gear, its Plugin Manager entry |
| `chrome` | one chrome type, `data.for` (chrome-settings@1) | `settings/chrome-<type>`, an app's copy `settings/chrome-<type>-<app>` | the right-click Settings… dialog of that chrome type |

`scope` left out means `app`, or `chrome` when `for` is set (`settingsScopeOf`). `owner` is only read for `plugin`,
`for` only for `chrome`; the validator (`settingsUiErrors`) reports a field that does not belong to the scope, and a
`plugin` interface without an owner.

**Interfaces are never shared across owners.** The console's interface (`settings/console`) belongs to the console's
own pages only. A plugin never renders through it, not as a fallback, not when the plugin has no asset of its own, and
not because the plugin's tab sits inside the console's Settings dialog. Two plugins never share one interface either:
each has its own asset id, and `extends` may point at a shared base (`settings/standard`) but never at another owner's
interface. A plugin that wants the console's look copies it into `settings/plugin-<id>`.

The same holds the other way: the console's pages never render through a plugin's interface.

## 2. Resolution order

`resolveSettingsInterface(owner, available)` in `core/engines/plugin-settings.ts` answers "which interface does this
page render through?" for an owner `{ kind: 'app' }` or `{ kind: 'plugin', id }`:

1. **Plugin page, plugin's own asset.** `settings/plugin-<id>` exists with `scope: plugin` and `owner: <id>` → that
   asset, `source: 'asset'`.
2. **Plugin page, no asset.** A generated default from the plugin's registered settings tab(s) and groups,
   `source: 'generated'`, with the id `plugin-<id>` so a save turns it into the plugin's own asset without renaming:
   - `scope: plugin`, `owner: <id>`;
   - `layout: list`, `header: compact`, `search: false`, `descriptions: true` (the plugin shows a short page);
   - `levels: true`, `defaultLevel: basic` (every settings interface keeps its level toolbar), `levelOf` naming every
     tab id, group id and setting key the plugin registered, each at `basic`, so the plugin's keys are the interface's
     keys from the first render;
   - `tabs`: the plugin's tab ids in their registered order, `parent: plugins` kept; `hide: []`, `groups: []`.
3. **Console (app) page.** The app's picked `settings` asset (`settings/console` in the Dev Console) when its scope
   is `app`, `source: 'asset'`; else the framework default (`SETTINGS_UI_DEFAULTS`, `source: 'default'`).
4. **Never across.** A `plugin` asset is never returned for an app page; an `app` or `chrome` asset is never returned
   for a plugin page, whatever its id. A `settings/plugin-<id>` asset whose `owner` is another plugin is ignored for
   `<id>` (and reported by `pluginSettingsErrors`).

`settingsInterfaceId(owner)` gives the asset id an owner's interface has (`plugin-<id>` / the app's pick), and
`settingsOwnerOf(assetId, data)` the owner an asset belongs to, for pickers, the Plugin Manager and the control
targets.

### Which owner a page has

- A console view (`view:<id>`) and every tab of the Settings dialog that is not under `plugins` → `{ kind: 'app' }`.
- A plugin's view (its `SettingsTab.plugin`, its `data-axf-plugin` root, the Settings → Plugins → `<plugin>` sub-tab,
  its screen's settings gear, `console.pluginsettings`) → `{ kind: 'plugin', id }`.
- Chrome dialogs are chrome-settings@1 and do not go through this engine.

"Every page has the correct default settings interface" means: an app page resolves to the app's own interface, a
plugin page to the plugin's own (asset or generated), and `pluginSettingsErrors` is empty for the app's assets.

## 3. Address and API

Every interface is reachable without the UI, the same on every surface (console API, MCP, CLI, voice):

| What | Address / command |
| --- | --- |
| Open a plugin's settings | `console_open` → `view:settings/tab:settings.tabs=plugins/tab:<plugin>` (`console.pluginsettings` control target) |
| Read which interface a page uses | `GET /api/console-control?address=setting:axf.settings.interface&owner=plugin:<id>` → `{ id, source, scope, owner }` |
| The interface's own fields | every setting of the resolved interface is a `setting:<key>` target under that owner |
| Reset (section 4) | action `settings.reset` with `{ scope, includeAssets }`; the plan first through `settings.reset.plan` |

## 4. Reset: the plan before the confirm (settings-reset@1)

Reset is never immediate. The UI asks in a confirm dialog that carries:

- the **scope**: `console` (the app's own settings) or a plugin id (that plugin's settings only);
- a **switch** "Include assets", off by default: on, the changed asset picks and skins in the scope are cleared too;
- a **scrollable table** of what will change: every setting key to clear (with its current and default value) and,
  when the switch is on, every changed asset or skin (type, current id, default id). The rows are the same rows the
  settings panel's changed-assets table shows, from one engine.

`planSettingsReset(scope, includeAssets, state)` in `core/engines/settings-reset.ts` returns that plan; the confirm
dialog renders it, and the action that runs after the confirm applies exactly the plan. The contract, cases and
expected rows are in `fixtures/settings-reset.json` (`check-settings-reset.mts`).

### What goes in

`ResetState`: the saved values (`SettingsRegistry.savedValues()`), the registered tabs and groups (which keys are whose),
the app's app-look@1 document (or, with no document yet, the active slot ids and the manifest defaults), and an optional
name lookup for asset ids.

### Whose key is it

`keyOwner(key, state)`: a key registered in one of a plugin's groups (`pluginSettingsGroups`, section 2), the plugin's
look key `axf.plugin.<id>.look`, or a key under the plugin's own prefix `<id>.` belongs to that plugin; everything else
is the console's. `isLookKey(key)` marks the keys that hold look or asset state rather than a setting (`axf.hide.*`,
`axf.roll.slot.*`, `axf.widgets.arrange.*`, `axf.chrome.*`, `axf.tokens.*`, `axf.appearance.*`, `axf.lock.hubskin*`,
`axf.plugin.<id>.look`, and the document key `axf.skin.look`): those are never settings rows and are cleared only with
the switch. The app-look document itself is never cleared; it is restored (below).

### The rows

- `settings`: every saved, non-look key in the scope, with its registered label, group and default when registered,
  sorted by key.
- `assets`: `changedAssets(state)` filtered to the scope. `changedAssets` is the one source of the changed-assets table:
  slot picks that differ from the snapshot (`slot`), hidden chrome (`hidden`), spacing (`spacing`), the app skin on or
  following axHub (`skin`) and its overrides and colour theme (`skin-override`), every `ui:` / `plugin:` scope's skin
  (`scope-skin`) and overrides (`scope-override`), every plugin's theme override (`plugin-look`) and every saved look
  setting (`look-setting`). Every row carries `scope` (`console` or `plugin:<id>`), a label, the current value and the
  default it goes back to. Sorted console first, then by kind, then by type. The rows are listed in the plan even while
  the switch is off (the dialog shows them greyed, "kept"); they are cleared only when it is on.

### What the action does (`apply`)

- `clear`: the settings rows' keys, plus, with the switch on, the scope's look keys.
- `look`: with the switch on, `restore` for the console (own picks back to the snapshot, skin off, `ui:` scopes dropped,
  every `plugin:` scope kept: those are the plugins' own) or `drop-scope` for a plugin (only `plugin:<id>` dropped);
  `null` otherwise. `applyResetToLook(look, plan, at)` is the pure document change and records the one undo
  (`undo.action = settings.reset`, `undo.scope`). With no document yet, `restore` means the runtime's slot reset.
- `scopes`: the scope keys dropped.

`empty` is true when there is nothing to clear and no look change (the dialog's confirm is disabled; `summary` reads
"Nothing to reset"); otherwise `summary` is one line, "3 settings · 2 assets" (or "… 2 assets kept" with the switch off).
`tableRows` (8) is how many rows show before the table scrolls; the dialog never grows past it.

### Scope isolation (checked by `check-settings-reset.mts` over every fixture plan)

A plugin's plan never names a console key, another plugin's key, or another scope; the console's plan never names a
plugin's key and never drops a plugin's skin scope. Without the switch no look key is cleared and the look is untouched.

### API

| What | How |
| --- | --- |
| The plan | action `settings.reset.plan` `{ scope, includeAssets }` → `ResetPlan`; REST `GET /api/console-control?address=action:settings.reset.plan&scope=…&includeAssets=…`; MCP `console_control_act`; CLI `axf console act settings.reset.plan --scope plugin:<id> --include-assets`; voice "reset <plugin>'s settings" opens the dialog |
| The reset | action `settings.reset` `{ scope, includeAssets }`, destructive: needs `confirm` on every surface (the dialog in the UI, `confirm: true` through control) |
| Request errors | `resetRequestErrors(raw)`: a bad scope or a non-boolean switch is a 400 with these lines |

## 5. Checks

- `npx -y tsx framework/spec/check-settings-ui.mts`: the `settings` type's enums (including `scope`) survive the engine,
  every starter validates, scope / owner / for errors fire.
- `npx -y tsx framework/spec/check-plugin-settings.mts`: replays `fixtures/plugin-settings.json` against
  `plugin-settings.ts`; the framework's starters have no plugin-settings@1 errors; no plugin resolves to
  `settings/console`.
- `npx -y tsx framework/spec/check-settings-reset.mts`: replays `fixtures/settings-reset.json` against
  `settings-reset.ts`; scope isolation and the applied look over every plan.
- `npx -y tsx framework/spec/gen-fixtures.mts` regenerates both fixtures with every other one.
- `node framework/cli/axf.mjs schemas` regenerates `framework/schemas/json/settings.schema.json` (scope enum, owner
  pattern, for enum, extends, toolbar, levels).
