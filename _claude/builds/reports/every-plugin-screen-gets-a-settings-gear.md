# Every plugin screen gets a settings gear (draft)

Brett, 2026-11-16: "Every one has a gear icon to open its settings, right? Yeah, check and fix."

## Audit, before (s1)

`node framework/cli/check-plugin-settings.mjs --report` on cea0d59af:

```
plugin settings: 71 plugins, 44 with a screen, 44 of them with a settings sub-tab, 4 with a gear (host gear not mounted)
  hand-made gear (4): mcp-client, project-wizard, session-checkin, voice-notes
  no gear (40): agent-manager, agent-swarm, agent-voice, ai-assistant, amberx-listeners, audio-extract, brand-library, build-breaker, build-orchestrator, builds-page, changes-grid, chat-viewer, claude-accounts, claude-handoff, claude-settings, codebase-changes, context-menu-designer, crew-live, demonstration-designer, fable-rebuilds, feature-matrix, gate, glossary-index, maintenance, md-studio, notes-browser, notify-control, output-recorder, plan-studio, plugin-commands, plugin-manager, plugin-update, shipped-features, skin-editor, skin-gallery, theme-editor, theme-manager, todo-manager, token-control, ui-review
  settings only, no screen (27): activity, agent-slots, ai-keys, alerts-bell, approvals-banner, basic-filter, build-profiles, claude-badge, claude-session, console-commands, console-terminal, container-access, feature-assist, follow-amber, github-app, hub-sync, main-build-status, molly-guide, plugin-switches, plugins-menu, project-switcher, push-banner, ref-links, snapshot-manager, systems-check, wake-listener, whats-shipped
```

- **44** plugins draw a screen (a view in their web library, framework libraries spread in included). Confirmed.
- **Settings sub-tab: 44 of 44.** The plan's "10 without a settingsTab" (brand-library, build-breaker, builds-page,
  demonstration-designer, gate, mcp-client, md-studio, plan-studio, shipped-features, ui-review) all already declare
  `settingsTabs` with `parent: 'plugins'` in their web entry, and every plugin.json lists a `settings-tab:` in
  `provides`. Not confirmed: the gap is the gear, not the tab. Steps s10–s14 add the default tab panels
  (enable/logs/info) on top of what they keep, no new tab ids.
- **Gear on the screen: 4 of 44** (mcp-client through framework/libs/mcp, project-wizard, session-checkin, voice-notes).
  19 more reach their settings only through an application-menu entry (`settings.open:<tab>` in web/menu.ts), which
  is not a gear on the screen. The other 21 have no way from the screen to their settings at all.
- **hub-sync** has a settings sub-tab (`hubsync`, from framework/libs/hubsync) and no screen of its own, so it gets
  no gear; its sub-tab id matches what `provides` declares.

So the answer to "every one has a gear, right?" was no: 40 of 44 plugin screens had none.

## How plugin screens are hosted (s2)

- **Mount.** `framework/react/AppShell.tsx` draws the page: `<main class="fx-main">` → `.fx-main__inner[data-axf-view]`
  → `SkinScope` → `ControlScope address="view:<id>"` → `views[id].render()`. The shell has no page header of its
  own; each plugin draws its own `<header className="fx-pagehead">` (eyebrow, h1, one-line description;
  check-plugin-pages.mjs holds it to the design language).
- **The one place every plugin view passes through in the console** is `countingUses()` in
  `apps/console-web/src/pluginLoader.tsx`, called from `App.tsx` for every bundled plugin (eager and lazy, real and
  stand-in) before `withPluginTheme`. It already wraps each `views[k].render()` in `<Used folder>`.
- **How settings open.** Every existing gear and menu entry dispatches `settings.open:<tabId>`
  (`framework/libs/settings` registers the `settings.open` action; with a sub-tab id it opens Settings → Plugins on
  that sub-tab, since every plugin tab has `parent: 'plugins'`). The control address is
  `view:settings/tab:settings.tabs=plugins` plus the sub-tab. The tab id is the plugin's first `settingsTabs[0].id`
  (often the folder, sometimes not: `mcp` for mcp-client, `hubsync` for hub-sync, `alerts` for alerts-bell).
- **Tap-to-confirm** needs no code: `framework/react/tapConfirm.ts` arms any button inside a `role="toolbar"`.

**Chosen approach:** one shared gear, drawn by the console host, not 44 hand edits. `countingUses()` wraps every
plugin view in a `PluginViewHost` that puts a slim `role="toolbar"` row (aria-label "<plugin> screen") above the
screen with `PluginSettingsGear` at its right end. The row is its own flex line, so it never draws over the
plugin's page head (attached things snap, never overlap). A plugin opts out only with plugin.json
`"settingsGear": false` plus `"settingsGearReason"`. The four hand-made screen gears are removed (s5/s6) so each
screen shows exactly one.

## Host gear (s3–s4)

- `apps/console-web/src/PluginSettingsGear.tsx`: `PluginSettingsGear` (framework `IconButton`, icon `settings`,
  aria-label "<plugin> settings", `data-axf-plugin-gear=<folder>`) and `PluginViewHost` (a `role="toolbar"` row,
  aria-label "<plugin> screen", gear at the right end; `display: contents` wrapper so the screen's own layout is
  untouched). Tokens only (`pluginSettingsGear.css`).
- Address: `view:<screen>/button:settings-gear` (relative inside the view's ControlScope). The plan said
  `plugin:<id>/settings-gear`, but console-control@1 does not allow a button under a `plugin:` segment
  (`CONSOLE_CONTROL_PARENTS`), and changing the grammar is a contract change (Fable). The screen-scoped button
  address is what every other screen button uses.
- Mounted once in `countingUses()` (`pluginLoader.tsx`), which every plugin view goes through. The tab it opens is
  the plugin's `settingsTabs[0].id`, or the folder when plugin.json declares `settingsTab: { default: true }`.
- Opt-out: plugin.json `"settingsGear": false` + `"settingsGearReason"`. The plugin@1 schema's root is open, so no
  schema change was needed; documenting the two fields in `plugin.schema.json` is left for a Fable pass.

## One gear per screen (s5–s6)

- Removed the hand-made screen gears: session-checkin (page head), voice-notes (page head). project-wizard's was a
  "fix it" button inside a GitHub/VPS notice; it is now a labelled "Fix in settings" button (arrow icon), so the
  screen still has exactly one gear. framework/libs/mcp's "Manage servers" button (mcp-client) keeps its text and
  now uses the sliders icon; synced into the console, AmberX and axHub web baked copies (one line each; a full
  rebake of the console is blocked: rebake.mjs reports its baked copy as edited).
- Visual check: `apps/console-web/scripts/plugin-gear.e2e.mjs` opens every plugin screen in the control inventory
  on desktop (1400×900) and phone (390×844) against `vite preview`, and counts buttons drawing the gear glyph.
  Result: 48 screens × 2 viewports, every rendered screen has exactly one gear, in a labelled role="toolbar",
  not overlapping the page head; pressing it on desktop opens Settings. Skipped: audio-extract (off by default),
  agent-manager / agent-swarm / sessions (not registered with the API offline), theme-manager (crashes offline
  without the axHub look: `rt.asset(type).data` on a type with no active asset; pre-existing, not gear-related).

## Default settings sub-tab (s7)

`apps/console-web/src/PluginDefaultSettingsTab.tsx`: `PluginDefaultSettingsTab` (on/off switch, version, builtWith
model badge, dependencies and dependents from plugin-inventory@1 via the Plugin Manager's `/inventory`, the last 20
log lines, Open in Plugin Manager) and `withDefaultSettingsTab()`. A plugin gets it with plugin.json
`"settingsTab": { "default": true }` (optional label / icon / order). `App.tsx → underPlugins()` applies it before the
parent rule, so the tab is always under Settings → Plugins: when the plugin has no tab of its own the sub-tab id is its
folder; when it has one, the default panels go to the top of that tab and its own settings stay as they are. The
shared Install & uninstall panel is added unless the plugin already ships one. The Plugin Manager's `uiOf()` counts the
default tab too.

## API (s8)

- Console action `plugin.settings.open:<plugin>` (folder, manifest id, last id segment or name):
  `apps/console-web/src/pluginSettingsActions.ts`, registered in `main.tsx`. Same press as the gear.
- Control targets: every gear is `view:<screen>/button:settings-gear` (live, registered by the framework
  IconButton inside the view's ControlScope; static, in `server/console_control.py static_targets()` with `opens`),
  every plugin sub-tab `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=<tab>`. The control
  inventory (`scripts/control-inventory.mjs`) now resolves tab ids from constants anywhere in the plugin's web
  folder (`FOLDER`, `VIEW`), double-quoted labels, library tabs a plugin declares in `provides`, and the default tab;
  every plugin entry carries `settingsTab`, `settingsTabId` and `settingsGear`. Plugins with a sub-tab in the
  inventory: 58 → 71 of 71; gears: 44.
- REST: `GET /api/console-control/plugins/<id>/settings[?live=1]` → `{plugin, folder, label, version, enabled,
  tab {address, id}, gear, view, settings[], open {action, address}, can}`;
  `POST /api/console-control/plugins/<id>/settings/open` opens it in the open console (console_open semantics);
  on/off stays `POST /api/console-control/plugins/<id>/enable|disable`.
