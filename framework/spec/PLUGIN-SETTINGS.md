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
dialog renders it, and the action that runs after the confirm applies exactly the plan (keys cleared, assets back to
their defaults). A plan for a plugin never names a console key or another plugin's key; a plan for the console never
names a plugin's key. The contract, cases and expected rows are in `fixtures/settings-reset.json` (section 5 of this
file is written with that step).

## 5. Checks

- `npx -y tsx framework/spec/check-settings-ui.mts`: the `settings` type's enums (including `scope`) survive the engine,
  every starter validates, scope / owner / for errors fire.
- `npx -y tsx framework/spec/check-plugin-settings.mts`: replays `fixtures/plugin-settings.json` against
  `plugin-settings.ts` (added with the engine step).
- `node framework/cli/axf.mjs schemas` regenerates `framework/schemas/json/settings.schema.json` (scope enum, owner
  pattern, for enum, extends, toolbar, levels).
