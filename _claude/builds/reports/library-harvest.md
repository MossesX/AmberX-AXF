# Library harvest — ranked report (Nov 7 2026, Fable, agent Earl the Ear)

Build `library-harvest`. Brett: "Harvest as many reusable libraries as possible out of our own code (AmberX, Console,
axHub, framework)." Addendum 1: every harvested library ships a configuration manifest and a no-code import wizard.

## How the scan was done

1,523 source files (TS/TSX/MJS/Python) under `apps/*` (excluding baked `src/axf`, dist, node_modules, Android),
`framework/{core,react,libs,cli,python}`. Two passes: (a) function / component names defined in three or more owners
(an owner = an app, a console plugin or a framework folder), (b) byte-identical 600-character bodies in two or more
files. Already-harvested libraries (`framework/libs`, 20 of them, Oct 2026) were taken as the baseline: the report only
lists what is *still* duplicated after them. Script: see the build's change entry; the counts below are from the scan.

Ranking = consumers × how identical the copies are ÷ (effort + risk). Effort: S ≤ 30 min, M ≤ 2 h, L > 2 h.

## Ranked candidates

| # | Library | What | Where it is duplicated today | Consumers | Effort | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `libs/moremenu` | The ⋯ "More" menu: an IconButton opening a framework popover menu (fx-popover + fx-menu), closes on pick / outside tap / Esc / scroll | Two byte-identical variants (`web/more.tsx` ×4, `web/MoreMenu.tsx` ×6) | 10 console plugins: agent-manager, ai-assistant, claude-handoff, feature-matrix, codebase-changes, context-menu-designer, plugin-update, plugins-menu, theme-manager, todo-manager | S | low (only the popover placement rule is unified) | **PR 2 of this build** |
| 2 | `libs/jsonstore` (Node part) | `readJson(file, fallback)`, atomic `writeJson` (tmp + rename), `dataDir`, `newId`, `slug`, `nowIso` for plugin CLIs | 15 plugin `.mjs` CLIs define `readJson`, 9 `writeJson`, 8 `newId`, 16 `slug` (near-identical one-liners) | activity, agent-swarm, claude-handoff, claude-settings, codebase-changes, feature-matrix, maintenance, plan-studio, project-wizard, push-banner (land, merge-queue), ref-links, session-checkin, token-control, ui-review, framework/cli | S | low | next PR |
| 3 | `axf_server.plugin_store` (Python) | `data_dir()`, `_read_json`, `get_settings` / `put_settings` (defaults + saved + reset), `get_config` / `put_config` per plugin | 21 plugin servers define `data_dir`, 9 `get_settings`/`put_settings`, 8 `get_config`/`put_config`, 5 `_read_json` | agent-manager, agent-slots, chat-viewer, console-commands, console-terminal, container-access, maintenance, plugin-commands, snapshot-manager, systems-check, activity, ai-assistant, brand-library, claude-handoff, main-build-status, plugins-menu, push-banner, whats-shipped | M | low–med (settings merge rules differ slightly per plugin; keep each plugin's defaults) | planned |
| 4 | `libs/format` | `fmtTime`, `fmtDate`, `fmtDay`, `when` (relative time), `money`, `formatMinutes`, hooks `useNow` / `useTick` | `fmtTime` ×6 identical, `when` ×17, `money` ×8, `fmtDate` ×4, `fmtDay` ×4, `useNow` ×5, `useTick` ×4 | build-orchestrator, feature-matrix, agent-swarm, ai-assistant, agent-manager, build-manager, codebase-changes, session-checkin, expenses, console-web, amberx-droid, axhub-web, md-studio, notes-browser, approvals | M | med (the `when` variants round differently; harvest the identical ones first, each plugin keeps its wording) | planned |
| 5 | `libs/plugin-panels` | Plugin settings scaffolding: `SettingsPanel`, `StatusPanel`, `OpenPanel`, `StatusChip`, `Section`, `Detail`, `Page` | `SettingsPanel` ×12, `StatusPanel` ×8, `OpenPanel` ×6, `StatusChip` ×5, `Section` ×4 | activity, agent-slots, brand-library, build-profiles, claude-badge, claude-session, md-studio, notes-browser, plugin-commands, plugin-update, project-wizard, molly, alerts-bell, approvals-banner, container-access, feature-assist, main-build-status, maintenance, session-checkin, hubsync | M–L | med (visual: needs UI Review shots) | planned |
| 6 | `core/tinystore` | The subscribe / emit / snapshot external-store pattern + `useStore` / `useStatus` hooks (useSyncExternalStore) | `useStore` ×9, `useStatus` ×7, `subscribe` ×10, `emit` ×13, `snapshot` ×8 | activity, ai-assistant, audio-extract, build-manager, claude-handoff, codebase-changes, output-recorder, console-web, alerts, agent-manager, agent-slots, console-terminal, context-menu-designer, maintenance, md-studio, token-control, voice-notes | S | low | planned |
| 7 | use `libs/tree` | Six owners still draw their own `TreeView` although lib-tree exists | plan-studio, theme-editor, ui-review, expenses, libs/ashes, libs/plugintheme | M–L | med (feature gaps in lib-tree: meters, inline editors; add parts rather than fork) | planned |
| 8 | use `libs/datagrid` | Own `GridView` in 4 owners | changes-grid, theme-editor, ui-review, expenses | M | med | planned |
| 9 | `react/starter` | Dialogs every `axf init` app copies byte for byte: `DevConsole`, `NewFile`, `ConfirmDelete`; `registerActions`, `folderOf`, `visibleSearch` | identical in amberx-droid, axhub-web, demo (+ walkthrough-studio, molly) | 5 apps | M | low–med (template output: move to the framework, templates import instead of copy; re-bake) | planned |
| 10 | `libs/miclease` | `createLease` (one mic owner at a time) | byte-identical in amberx-droid `miclease.ts` and agent-voice `web/lease.ts` | AmberX, agent-voice (Gizmo) | S | low | planned |
| 11 | `libs/attachments` | `fileToImage` + attachment helpers of the chat UIs | byte-identical in companion `api.ts` and ai-assistant `api.ts` | AmberX companion, ai-assistant | S | low | planned |
| 12 | plugin-lifecycle default hooks | 21 plugins ship the identical template `hooks.mjs` (`checks` = data folder exists) | `_template` copy in 21 plugins | 21 plugins | S | low (lifecycle supplies the default when a plugin has no hooks) | planned |
| 13 | `axf_server.health` | `ensure_health`, `health_probe`, `retry_delays` | ×6, ×5, ×4 plugin servers | agent-slots, build-orchestrator, github-app, maintenance, push-banner, ui-review, agent-manager, build-manager, systems-check | M | low | planned |
| 14 | `core/redact` | one `redact` for secrets in logs / transcripts | ×8 owners (activity, chat-viewer, claude-handoff, codebase-changes, crew-live, plugin-commands, core, cli) | 8 | S–M | med (security: the union of every pattern, never a weaker one) | planned |
| 15 | `libs/jsonstore` (web part) | `getJson` / `loadState` / `saveSettings` localStorage JSON wrappers | ×4, ×4, ×5 | plugin-update, project-wizard, session-checkin, console-web, agent-swarm, follow-amber, expenses, activity, claude-handoff, codebase-changes, console-terminal | S | low | with #2 |

Not harvested on purpose: `checks` / `onInstall` / `onUninstall` (61 plugins: that is the lifecycle contract, each
plugin's own), `check` (48: a local helper name, different bodies), per-plugin `settings` / `status` / `start`
(same name, different meaning).

## Addendum 1 — no-code library import wizard (built in PR 1)

- **library-config@1** (`framework/core/library-config.mjs` + `.d.mts`): every library's configuration manifest is
  *derived* from its `library.json` (parts → capabilities, params → settings, secret params → credentials, dependsOn /
  provides / placeholders → needs / gives / not-yet) plus an optional `config` block (connections to data sets, registry
  UIs, plugins, services, actions and assets; extra credentials; wizard mode + intro). All 20 shipped libraries derive a
  valid manifest without an edit; lib-datagrid ships the first explicit `config` block.
- **Wizard steps**, the same list on every surface: about → capabilities → connections → settings → credentials →
  review (steps with nothing to ask are skipped). `answerStep` takes a scripted file, an AI-assisted dialog turn or a
  voice turn alike; `draftErrors` says what still blocks apply, in words.
- **library-instance@1**: the configured instance asset (`<app>/library-instances/<id>.json`): capabilities on, their
  params, connections (`dataset:x`, `ui:x`, `plugin:x`, `service:x`, `action:x`, `asset:x`), credentials as references
  only (`env:NAME`, `secret:KEY`, `hub:PATH`; a value is refused), history. Reconfigure keeps id + history; disable /
  enable / remove are recorded, nothing is deleted. `installConfig` turns it into the `libraries.<key>` block the
  existing installer (`cli/libraries.mjs`, `core/library.ts` partOn / partParams) already reads.
- **CLI** `node framework/cli/library-config.mjs list | manifest | steps | wizard | instances | show | reconfigure |
  disable | enable | remove | install-config` (scripted: `--answers file.json`, `--set capabilities.drag.trash=false`).
- **Schemas**: `framework/schemas/library-config.json` (registry), `framework/schemas/json/library-config.schema.json`,
  `library-instance.schema.json`. **Fixture** `framework/spec/fixtures/library-config.json`, **check**
  `npx -y tsx framework/spec/check-library-config.mts` (137 checks, in CI).
- **Parity still to build** (steps in the Plan Studio plan): console REST + MCP (`library_config_*`) and the
  `library.*` console actions for voice; the App Designer runs the same steps; registering `library-instance` as an
  asset@1 type in `asset-types.json` (Fable) so instances live under `src/assets/`; Kotlin twin when Android resumes.

## Rules kept

No behaviour change in the extractions (byte-identical copies replaced by one import; the single unified rule, popover
placement in #1, is named in its PR). Every extraction is its own PR. Every library has `library.json` (library@1 →
library-config@1 derived) so it fits plugin-package@1 (manifest, version, deps). CI: check-theme / check-controls on
the new lib, `check:libs` typecheck, console typecheck, the new check.
