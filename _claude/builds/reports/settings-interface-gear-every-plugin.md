# Settings interface and gear for every plugin

Brett (Nov 16 2026): "They all need a settings page. They all need a settings interface."

Build `settings-interface-gear-every-plugin` · branch `claude/settings-interface-gear-every-plugin` · PR #725 ·
phases: Fable (s1–s3: contract, gear, header), Opus (s4–s28: this report).

## Result

- **Every plugin has its settings interface.** All 71 console plugins declare `plugin-settings@1` in plugin.json
  (tab, parent `plugins`, sections, option keys, gear). Audit: 71/71 complete, 0 missing
  (`_claude/builds/reports/settings-interface-gear-every-plugin.audit.json`).
- **Every Settings → Plugins sub-tab opens with the same three sections**: Enabled (switch), About (version,
  built-with badge, description, dependencies and who uses it, from plugin-inventory@1), Recent logs. The plugin's
  own options follow in the same tab. A switched-off plugin keeps its tab with the switch, so it can be turned back on
  there. Without the Plugin Manager the tab still shows a bare enable switch.
- **Every plugin screen carries one gear**: 44/44 screens have `PluginSettingsGear` (directly or through
  `PluginScreenHeader`, or the MCP library's `gear` option). The 3 hand-made screen gears and 3 hand-made banner-panel
  Settings buttons were replaced.
- **Every option is reachable without the UI** (REST, MCP, CLI, voice), and owner-only settings are never commands.
- **CI enforces it**: `framework/cli/check-plugin-settings.mjs` fails with file:line on a missing or wrong block, a
  screen without the shared gear, or a hand-made gear.
- **Waiting in UI Review**: `r-20261116-zyvou01`, three looks for the gear (icon last / icon + "Settings" / beside
  the title) plus the settings tab, desktop and phone.

## How each feature is reached

| Feature | REST | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|
| List every plugin's tab, options, gear | `GET /api/plugins/plugin-manager/settings` | `plugin-manager_plugin-settings-list` (plugin-commands@1) | `axf plugin-settings list` | search "<plugin> settings" (control targets) |
| One plugin: on/off, info, options + values | `GET …/plugin-manager/settings/<folder>` | `plugin-manager_plugin-settings-get` | `axf plugin-settings get <folder>` | `plugin.settings.get:<plugin>` |
| Set its own options | `PUT …/plugin-manager/settings/<folder>` `{"options":{key:value}}` | `plugin-manager_plugin-settings-set` | `axf plugin-settings set <folder> key=value …` | `plugin.settings.set:<plugin>:<key>:<value>` |
| Enable / disable | `POST …/settings/<folder>/enable` · `/disable` (`{"force":true}`) | `plugin-manager_plugin-settings-enable` / `-disable` | `axf plugin-settings enable\|disable <folder> [--force]` | "enable plugin X", `console.control.plugin:<id>:on` |
| Recent logs | `GET …/settings/<folder>/logs?limit=&level=` | `plugin-manager_plugin-settings-logs` | `axf plugin-settings logs <folder>` | — (read in the tab) |
| Open the sub-tab (deep link) | `POST /api/console-control/do {verb:"open", address}` | `console_control_*` open | `axf plugin-settings open <folder>` | `plugin.settings.open:<plugin>`, "open <plugin> settings" |
| Press a screen's gear | console control `press button:plugin-settings-gear-<tab>` | same | `axf console do press …` | same |

The sub-tab address is `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=<tab>` (all 83 plugin
settings tabs are in `src/control/inventory.json`; every plugin target links its `settingsTab`). The CLI and the
console actions find the Plugin Manager by capability (`service:axf.plugin-settings@1`), never by folder name. Each
option key is a console-control setting: console-run options go through the open console; server-run options (the
plugin's own config) are set without a browser through `apps/console-web/server/plugin_options.py`.

## What changed, by step

- **s4** `plugin-manager/web/DefaultPluginSettingsTab.tsx` (framework Section / Switch / Chip / ModelBadge / Note),
  `src/settings/pluginTabs.ts` (a tab for every plugin, the default panel first, renderer registered by the Plugin
  Manager, bare switch fallback). Console bake: plugin-settings engine, gear, header, `.fx-pagehead__tools`.
- **s5** Plugin Manager `/settings` routes (`server/plugin_settings.py`, Python twin of the engine replaying the
  fixture), named MCP tools, `test.py` (145 checks).
- **s6** `framework/cli/plugin-settings.mjs` (`axf plugin-settings`), `src/actions/plugin-settings.ts`
  (`plugin.settings.open/get/set`), control inventory: every plugin's tab appended last.
- **s7–s16** brand-library, build-breaker, builds-page (new: default view, filter, refresh seconds),
  demonstration-designer (12 pitch options), gate (link to Gate & rules; rules and auto-lander stay off the option list),
  mcp-client (timeout is now a stored option; library gains `gear`), md-studio, plan-studio (new default status, read-only
  category tree), shipped-features (new grouping, badge on/off and interval), ui-review (its hosted Choices and
  Predicted-look options; `waitForLook` owner-only).
- **s17** hub-sync: no screen (no gear possible, `gear: false`); tab reachable over every API; its connection
  (address, sign-in) stays out of the options.
- **s18–s21** the shared gear on the other screens; the Plugin Manager's four layouts each carry it; hand-made gears
  removed (session-checkin, voice-notes, project-wizard). Audit recognises the shared gear.
- **s22–s23** blocks for the 27 plugins without a screen; server options for activity, agent-slots (caps:
  owner raise), plugins-menu, snapshot-manager, whats-shipped; owner-only: push-banner merge/land switches, snapshot
  retention, plugins-menu publish and typed confirm; container-access and console-terminal access settings left out.
- **s24** `framework/cli/new-plugin.mjs` (`axf new-plugin`): every new plugin starts with the block, its tab, a real
  example option and the header gear.
- **s25–s26** `framework/cli/check-plugin-settings.mjs` + self-test, wired into CI with `test_plugin_options.py`.
  Lifecycle fixes (capability lookup, fixture with fictional folders).
- **s27** three ui-choices@1 settings assets (`plugin-manager/assets/settings/plugin-settings-gear-in-*`), shots in
  `settings-interface-gear-every-plugin/shots/`, submitted to UI Review.

## Tests and checks (run in this session)

Pass: console typecheck (`tsc --noEmit`), `check-plugin-settings.mjs` (72 plugins incl. template, 45 gears),
`spec/check-plugin-settings.mjs` (120), `check-plugin-settings-cli.mjs` (6), `check-plugin-gear.mts` (35),
`check-console-control.mjs` + `.mts` (290), `check-control.mts` (396), `check-plugin-commands.mjs` (59),
`check-toolbars`, `check-theme`, `check-controls`, `check-chrome-assets`, `chrome-settings check`, plugin-lifecycle
check for every lifecycle plugin (0 failures), console-control server tests, parity (REST = CLI = MCP = voice, 132
comparisons), console MCP tools (206), `test_plugin_options.py`, plugin tests of every plugin touched with a server
change (plugin-manager 145, gate 34 + 21, ui-review 229, plan-studio 27 + 27, mcp-client 24, activity 142, agent-slots
27, plugins-menu 33, snapshot-manager 49, push-banner 183, whats-shipped 47).

Fail, unchanged by this build (same result on the phase's starting commit 1b2c83029): `ai-assistant/test.py`
("chat folders removed"), `systems-check/test.py` ("ask first"), and three that need Node 22 on this VPS's Node 20
(`context-menu-designer` and `plugin-update` use `--experimental-strip-types`, `shipped-features` uses `node:sqlite`).

## Notes and choices made without asking

- The REST routes live under the Plugin Manager (`/api/plugins/plugin-manager/settings/<folder>`), not
  `/api/plugins/<folder>/settings`, because many plugins already own that path.
- Server-side options reuse the `claude-settings-registry@1` format (a plugin's `registry.json` with its own
  `service`) through one helper, `server/plugin_options.py`, instead of a new contract.
- Two option keys are known only to the open console (`build-breaker.range`, `example.refresh`): the inventory
  generator's regex misses their spec; they are still set through the open console (warning in the check).
- `framework/library-templates` are framework libraries, not console plugins, so they were left alone.
- The UI Review options are predicted looks: the picked one is built in a follow-up (setting `axf.pluginGear.style`).
- Kotlin twin of plugin-settings@1 stays a deferred gap (PORTING.md, phase 2).
