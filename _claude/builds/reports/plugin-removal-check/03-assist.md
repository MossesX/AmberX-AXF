# Plugin removal check 03: ai-assistant, feature-assist, feature-matrix, build-breaker

Report only. Nothing was deleted or changed. Checked on `main` at `e1e8d3231` (Nov 27 2026).

## Verdicts

| Plugin | Verdict | What depends on it | What to move, and where |
|---|---|---|---|
| `ai-assistant` | **KEEP** | It is the only provider of `axf.llm@1` and `axf.live-sessions@1` (`apps/console-web/plugins/ai-assistant/server/__init__.py:252`, `:262`). Kept plugins call `axf.llm@1`: `claude-badge/server/__init__.py:78`, `systems-check/server/__init__.py:591`, `:659`, `systems-check/server/checks.py:213`, `routine.py:245`, `whatsnew.py:70`, `derive.py:250`, `mosses.py:156`, `maintenance/server/profiles.py:62`, `agent-manager/server/llm.py:30`, `wake-listener/server/__init__.py:99`, `:202`. `activity/server/__init__.py:82` reads `axf.live-sessions@1`. Its action `ai-assistant.open` is called by `agent-voice/web/index.tsx:93` and `apps/console-web/src/assets/context-menu/amber.json:110`; `systems-check/web/FixHelp.tsx:124` opens its settings tab. `systems-check/test.py:80`, `:87` (run in CI) expect its self-check by name. | Only if the chat screen must go: first move the model service (`LlmService`, provider profiles and stored keys in `config.json`, usage) to a kept plugin. `ai-keys` is the natural home (it already provides `axf.ai-keys@1`; the engine itself is already in `framework/python/axf/assistant_host`). Then re-point the three callers above and the systems-check test. |
| `feature-assist` | **SAFE** | Nothing. It only consumes (`axf.llm@1`, `axf.agents@1`, `axf.build-dispatch@1`) and fills two Plan view slots (`apps/console-web/src/views/Plan.tsx:179`, `:339`), which render empty without it. | Nothing. |
| `feature-matrix` | **SAFE** | Nothing kept imports the plugin folder. The `feature-matrix@1` engine that kept code uses lives in the framework, not the plugin (`framework/plan/feature-matrix-core.mjs`, `feature-matrix-apply.mjs`, CI check `.github/workflows/android.yml:90`) and stays. Only link in: `build-breaker/web/buildMenu.ts:17` (a menu item, also on the removal list). | Nothing. Leave the framework engine, its check and fixture, and the project files `_claude/builds/matrices.json` and `_claude/builds/profiles/*/matrices.json` (the uninstaller keeps them). |
| `build-breaker` | **SAFE** | Nothing. No other code calls its routes, `asks.mjs`, or `build-asks@1`. | Nothing required. `data/asks.jsonl` (205 kB, Brett's asks history) exists only in this folder and goes with it: copy it out first if the history is wanted. |

## Evidence

Method: read each `plugin.json`, `hooks.mjs`, web entry and server; grepped the repo outside each folder for the folder name, plugin id, capabilities, actions, slots, route prefix, command and MCP names, env vars, data paths and tables across `framework/`, `apps/`, `deploy/`, `services/axf-data`, `.github/workflows`, `CLAUDE.md` and `_claude/`. Ran `node framework/cli/plugin-lifecycle.mjs check <folder>` (all four: clean) and `uninstall.mjs --all --dry-run` (all four: `stale: []`).

### ai-assistant

- **Capabilities.** `plugin_services.provide("axf.llm@1", …)` and `provide("axf.live-sessions@1", …)` appear in no other plugin server. Every consumer lists the capability as `optional`, so the console still starts without it, but these stop working: the Claude badge (reports `no-llm`), the systems check's AI switches, credit check, routine and what's-new, Maintenance's Deep (AI) pass, wake-listener's Claude mode (falls back to offline matching), the assistant row in Activity. `agent-manager` falls back to its own model settings (`agent-manager/server/llm.py:30`).
- **Actions and events.** `ai-assistant.open`: `agent-voice/web/index.tsx:93`, `src/assets/context-menu/amber.json:110`. `settings.open:ai-assistant`: `systems-check/web/FixHelp.tsx:124`. `agent-voice` talks to the chat through `axf:assistant.*` window events (`agent-voice/web/bridge.ts:5-20`); without the assistant its talk-to-agent and spoken replies have no chat to drive.
- **Console and framework mentions.** `apps/console-web/src/lazyEngine.ts:55` (banner seed list), `src/assets/help/console.json:211` (help entry), `framework/core/engines/card-rules.mjs:426` (a home-card candidate reading its `usage` command; the card has a second candidate). The rest are comments and docs.
- **CI.** No workflow line names it; its `test.py` runs through the glob at `.github/workflows/android.yml:465`. `systems-check/test.py:80`, `:87` name `plugin:ai-assistant` and would fail after removal. `agent-manager/test.py:28` only sets its env var.
- **Hub users.** `"wallUsers": true`: signed-in hub users reach its chat at `/api/plugins/ai-assistant/app` (`apps/console-web/server/main.py:1362`, `:1453`). That page goes with the plugin.
- **Data.** `.axf-console/plugins/ai-assistant` (config with provider profiles and stored keys, conversations, sessions, usage). No Postgres table exists yet: `framework/spec/DATA-INVENTORY.md:147` only plans `assistant_conversations`, `assistant_messages`, `assistant_usage`; nothing in `services/axf-data` or `deploy/` names them.
- **Docs.** Marked lines the uninstaller strips: `_claude/memory/STATUS.md` (2), `plugins/README.md` (1), `framework/spec/LIVE-SESSIONS.md` (2), `framework/spec/ASSISTANT.md` (2). `CLAUDE.md` does not mention it.
- **Not verified here.** The AmberX app is not in this repo. `framework/plan/pending.json:18895` says AmberX loads this plugin unchanged, `:8263` plans to move what Gizmo needs out of it, and `_claude/THREADS.md:1127` shows a queued build `ai-assistant-gizmo-moved-to-the-console-remove-t`. Check the AmberX repo before any removal.

### feature-assist

- Outside mentions are docs only: `plugins/README.md:26`, `framework/spec/DESIGN-LANGUAGE.md:148`, `_claude/memory/STATUS.md:75`. `CLAUDE.md`: none.
- Provides slots `plan.top` and `plan.feature`, a dialog and action `feature-assist.build`: no caller outside the folder. The `plan.feature` slot is also used by `fable-rebuilds/web/index.tsx:61`, unaffected.
- Its `ai.chat.start` action call lands in `ai-assistant`; nothing else uses that action.
- Data: `.axf-console/plugins/feature-assist` (build history). No table. Features it already added to the plan and pending list stay.
- CI: only the `test.py` glob (`android.yml:465`), which skips a missing folder.

### feature-matrix

- The plugin is a UI and CLI (`matrix.mjs`) on top of framework code. Kept code depends on the framework side only: `framework/plan/pending-core.mjs:46-47`, `framework/plan/build-queue-core.mjs:169`, `build-orchestrator/web/orchestrator-core.mjs:109`, `codebase-changes/changes-core.mjs:108` (the `skip` and `fm` fields), `build-orchestrator/test.mjs:145-146` (reads `framework/spec/fixtures/feature-matrix.json`), `framework/cli/profiles.mjs:93-102` (moves `matrices.json` between profiles).
- No one calls `matrix.mjs`, the route prefix, or the action `feature-matrix.open`. It adds a row button to the builds grids and a button in the `builds.toolbar` slot (`src/views/BuildManager.tsx:189`, `Pending.tsx:85`, `build-orchestrator/web/ui.tsx:64`); those just disappear.
- After removal, tidy: `src/assets/help/console.json:163` (help entry), and regenerate `framework/spec/fixtures/page-toolbar-voice.json` (lines 456-473 list its toolbar) with `npx -y tsx framework/spec/check-page-toolbar-voice.mts --write`.
- Data: `.axf-console/plugins/feature-matrix` (Apply reports and a mirror). `framework/spec/DATA-INVENTORY.md:86` assigns `matrices.json` to build-orchestrator (`build_matrices`, planned).
- CI: `android.yml:90` runs the framework check, not the plugin. The plugin's `test.py` and `toolbar.test.mjs` run by glob (`android.yml:465`, `:469`).
- Docs the uninstaller strips: `STATUS.md` (1), `plugins/README.md` (1), `_claude/memory/docs/feature-matrix.md` (25), `rebuilds/LOG.md` (1), `rebuilds/feature-matrix-plugin.md` (11).

### build-breaker

- Outside mentions: `plugins/README.md:42`, `src/assets/help/console.json:157`, `framework/spec/fixtures/page-toolbar-voice.json:50-74`, `_claude/THREADS.md:242`. `CLAUDE.md` and the rules files: none, so no session rule tells agents to run `asks.mjs`.
- Provides a view, a `builds.toolbar` button and a "Build" item on every context menu (`build-breaker/web/buildMenu.ts`). All disappear with it; nothing else reads them.
- After removal, tidy: the help entry at `console.json:157` and regenerate `page-toolbar-voice.json` as above.
- Data: `.axf-console/plugins/build-breaker/asks.jsonl` (live copy) and the seed `data/asks.jsonl` in the folder. No table.
- CI: only the `toolbar.test.mjs` glob (`android.yml:469`). Its `test.mjs` is not run by CI.

## Removal order

1. `feature-assist`, `feature-matrix`, `build-breaker`: remove in any order with `uninstall.mjs --all`, then regenerate the toolbar voice fixture once.
2. `ai-assistant`: keep. Removing it needs its own build that moves the model service first.
