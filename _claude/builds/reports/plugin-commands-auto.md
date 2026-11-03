# Plugin commands, automatically — build report

Build `plugin-commands-auto` (Urgent profile, Opus), Brett Nov 3 2026 (voice): every plugin, existing and new,
automatically exposes all of its commands and reads through control@1, so they appear in the REST API, the MCP server
and the CLI with no extra per-plugin work. Branch `claude/plugin-commands-auto` (base `claude/token-control-opus` #250,
with `claude/console-commands` #249 merged in; merges after both).

## What was built

| Step | What |
|---|---|
| s1 Declaration | plugin.json `commands` (plugin-commands@1: `$axf`, `auto`, `items` with id / title / description / input JSON Schema / output / readOnly / destructive / confirm / navigate / skip-with-why, `noReads`). The existing vocabulary becomes commands without rewriting: server routes and the action bus (`rt.actions.register`). Schema in `framework/schemas/plugin.schema.json`. |
| s2 Auto surfaces | Engine `framework/core/engines/plugin-commands.mjs` (pure): route + action scanners, derivation, registry, projections `pluginCommandTools()` (MCP `<plugin>_<command>`, read-only / destructive annotations), `pluginCommandRoutes()` (REST), `pluginCommandCli()` (CLI), help text, coverage. control@1 `plugins` domain: `plugins.commands` (act run), `plugins.reads` (act read), `control.plugins.read / write / delete`. Plugin `plugin-commands` (capability `plugin-commands@1`): `commands.mjs` gate / plan / finish / CLI; `server/__init__.py` runs routes on the console itself (loopback, the plugin's own auth applies), actions in the open console through console-commands@1, and keeps the MCP tools in step (on start, every 30 s, on demand, on the settings switches). REST `GET / POST / DELETE /api/control/<plugin>/<command>` (token-control's `/api/control` routes hand plugin targets over). CLI `axf <plugin> <command> [--field value]`, `axf plugin …`, `axf plugins [plugin]`. |
| s3 Reads | Every GET route is a read; every plugin with a data folder gets `data` (list) and `data-file` (read one: JSON parsed, secret-looking keys redacted, salt / key / token / db files refused, never outside the folder); every plugin gets `info`. A POST that only reads can be declared `readOnly`. |
| s4 Backfill | `commands` block in every plugin.json: 51 console plugins, 10 AmberX plugins, the three `_template`s. Inventory below. |
| s5 Enforcement | `framework/cli/plugin-commands.mjs check` (framework-owned, works without the plugin) inside `plugin-lifecycle.mjs check` and CI (`spec/check-plugin-commands.mjs`): fails a route the scanner can't read, a declaration naming a route that's gone, a skip without a why, a plugin with no reads (unless `noReads` says why), a plugin without the block. The templates carry the block. |
| s6 Docs, tests | Page Plugins → Plugin commands (every command with REST / MCP / CLI and Try), settings sub-tab (MCP switches, last commands, Install & uninstall), guide "Plugins" in Token control → Docs, CONTROL.md, plugins README, help pack (100 % coverage kept), PORTING (Kotlin twin deferred). Tests below. |

Also fixed on the way (CI on the base): console-commands lacked `tabable` (plugins.mjs --check) and `web/menu.ts` (menu-reach).

## How it decides

- GET = read · POST / PUT / PATCH = command · DELETE, or a path / action id with delete / remove / reset / restore / clear /
  wipe / purge / uninstall / discard / drop / kill / destroy / revoke / rollback = destructive (confirm token, `control.plugins.delete`).
- Actions whose id ends in open / show / settings / view / focus / toggle / … only navigate.
- Endless GET streams (events, stream, live, sse, tail, ws; EventSourceResponse) and WebSockets are listed as "not commands".
- Ids: the path as words (`/plans/{pid}` → `plans-by-pid`); another method on the same path adds `-run / -set / -update / -delete`;
  a delete always says `-delete`; a clash takes the handler's name. Actions are `action-<id without the plugin prefix>`.
- MCP tool names are `<folder>_<id>` with underscores, cut to 64 with a hash.

## Tests

| Check | Before | After |
|---|---|---|
| `node framework/spec/check-plugin-commands.mjs` | — | 57 checks |
| `node apps/console-web/plugins/plugin-commands/test.mjs` | — | 41 checks |
| `python apps/console-web/plugins/plugin-commands/server/test_plugin_commands.py` | — | 53 checks |
| `npx -y tsx framework/spec/check-control.mts` | pass, 19 targets | 350 checks, 21 targets |
| token-control / console-commands tests | pass | pass |
| check-theme, check-controls, plugin pages, menu-reach, help coverage + check-help, console `tsc --noEmit` | pass | pass |
| `plugins.mjs --check` | 3 problems | 2 (asset-browser plan / pending items, already on main) |

Live: the real console (uvicorn + Vite, rebuild-shots) loaded the plugin, synced 691 MCP tools, and the page's Try ran
`activity/items` through the whole chain (screenshot `plugin-commands-auto/shots/after/plugin-commands-try-*.png`).

## Known gaps

- AmberX and axHub-web plugins are listed (their actions are commands) but run in their own app; the console answers
  `not_implemented` for them until those apps take commands.
- An action that acts on a row or selection (`ctx.payload`) needs its target in `input.args`; most of those are reachable
  through the plugin's own routes anyway (flagged as warnings by the coverage check).
- POST routes that only read are writes unless the plugin declares `readOnly` (safe default: they need `control.plugins.write`).
- axHub: the console's `/mcp` already goes through axHub; the hub's per-tool policy needs `<plugin>_*`, `plugin_commands`,
  `plugin_read`, `plugin_run` allowed (an axHub admin setting, like the `console_*` tools).
- Kotlin twin deferred (Android on hold).

## Inventory

| Plugin | Name | Reads | Commands | Need confirm | Run in the console (actions) | Not commands (why in the page) |
|---|---|---|---|---|---|---|
| `activity` | Activity banner | 6 | 10 | 1 | 2 | — |
| `agent-manager` | Agent manager | 20 | 35 | 7 | 2 | — |
| `agent-slots` | Agent cap | 5 | 3 | 0 | 0 | — |
| `agent-swarm` | Agent swarm | 7 | 3 | 0 | 0 | — |
| `agent-voice` | Agent voice | 7 | 15 | 3 | 6 | — |
| `ai-assistant` | AI assistant | 21 | 22 | 3 | 2 | GET /sessions/{cid}/events |
| `ai-keys` | AI keys | 5 | 11 | 1 | 2 | — |
| `alerts-bell` | Alerts bell | 3 | 0 | 0 | 0 | — |
| `approvals-banner` | Approvals banner | 3 | 4 | 0 | 4 | — |
| `audio-extract` | Audio Extract | 3 | 6 | 0 | 6 | — |
| `basic-filter` | Basic filter | 3 | 1 | 0 | 1 | — |
| `brand-library` | Brand library | 7 | 2 | 0 | 1 | — |
| `build-breaker` | Build Breaker | 4 | 1 | 0 | 1 | — |
| `build-manager` | Build manager banner | 5 | 8 | 0 | 5 | GET /live, GET /events |
| `build-orchestrator` | Build orchestrator | 5 | 1 | 0 | 0 | — |
| `build-profiles` | Build profiles | 3 | 1 | 0 | 1 | — |
| `builds-page` | Builds | 5 | 9 | 1 | 2 | — |
| `changes-grid` | Changes & features grid | 5 | 1 | 0 | 1 | — |
| `chat-viewer` | Chat viewer | 14 | 11 | 3 | 0 | — |
| `claude-badge` | Claude badge | 4 | 1 | 0 | 0 | — |
| `claude-handoff` | Claude handoff banner | 13 | 19 | 1 | 8 | — |
| `codebase-changes` | Codebase changes banner | 7 | 7 | 0 | 1 | — |
| `console-commands` | Console commands | 7 | 12 | 0 | 0 | GET /stream |
| `console-terminal` | Terminal | 11 | 8 | 1 | 3 | WEBSOCKET /sessions/{sid}/ws |
| `container-access` | Container access | 12 | 4 | 0 | 0 | — |
| `context-menu-designer` | Context menu designer | 4 | 5 | 1 | 3 | — |
| `fable-rebuilds` | Fable rebuilds | 5 | 4 | 0 | 3 | — |
| `feature-assist` | Feature assistant | 5 | 6 | 0 | 1 | — |
| `feature-matrix` | Feature matrix | 5 | 5 | 0 | 1 | — |
| `github-app` | GitHub | 4 | 7 | 0 | 0 | — |
| `hub-sync` | axHub sync | 3 | 0 | 0 | 0 | — |
| `main-build-status` | Main build status | 5 | 4 | 0 | 3 | — |
| `mcp-client` | MCP client | 5 | 6 | 1 | 0 | — |
| `molly-guide` | Molly guide | 5 | 6 | 0 | 4 | — |
| `output-recorder` | Audio Output Recorder | 3 | 3 | 0 | 3 | — |
| `plan-studio` | Plan Studio | 6 | 4 | 0 | 2 | — |
| `plugin-commands` | Plugin commands | 7 | 4 | 0 | 1 | — |
| `plugin-manager` | Plugin Manager | 7 | 5 | 0 | 5 | — |
| `plugin-switches` | Plugin switches | 3 | 1 | 0 | 1 | — |
| `plugin-update` | Plugin Update | 3 | 1 | 0 | 1 | — |
| `plugins-menu` | Plugins menu | 7 | 12 | 1 | 7 | — |
| `project-wizard` | Project wizard | 3 | 6 | 0 | 0 | — |
| `push-banner` | Push banner | 9 | 11 | 2 | 1 | — |
| `session-checkin` | Session check-in | 6 | 4 | 1 | 0 | — |
| `snapshot-manager` | Snapshot Manager | 10 | 6 | 2 | 1 | — |
| `systems-check` | Systems check banner | 15 | 21 | 2 | 2 | — |
| `theme-manager` | Theme manager | 5 | 5 | 1 | 1 | — |
| `todo-manager` | Todo manager | 8 | 17 | 3 | 7 | — |
| `token-control` | Token control | 7 | 7 | 2 | 0 | — |
| `ui-review` | UI Review | 12 | 18 | 3 | 3 | — |
| `voice-notes` | Voice notes | 3 | 0 | 0 | 0 | — |
| amberx-droid:`ai` | AI connection | 1 | 4 | 0 | 4 | — |
| amberx-droid:`approvals` | Terminal (held commands) | 1 | 2 | 0 | 2 | — |
| amberx-droid:`commands` | Voice command center | 1 | 2 | 0 | 2 | — |
| amberx-droid:`dictation` | Dictation | 1 | 2 | 0 | 2 | — |
| amberx-droid:`monitor` | Background monitoring | 1 | 3 | 0 | 3 | — |
| amberx-droid:`notes` | Notes | 1 | 3 | 0 | 3 | — |
| amberx-droid:`tasks` | Tasks | 1 | 2 | 0 | 2 | — |
| amberx-droid:`voice` | Voice control | 1 | 2 | 0 | 2 | — |
| amberx-droid:`walkthrough` | Walkthrough | 1 | 1 | 0 | 1 | — |
| amberx-droid:`web` | Web | 1 | 2 | 0 | 2 | — |

**Total:** 61 plugins, 736 commands and reads (51 console plugins).
