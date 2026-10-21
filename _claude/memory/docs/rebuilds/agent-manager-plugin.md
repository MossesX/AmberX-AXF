# Rebuild report — `agent-manager-plugin` (Agent manager plugin, Fable rebuild Oct 20 2026)

Branch `fable/agent-manager`. Replaces the Opus build of Oct 18 2026 (`apps/console-web/plugins/agent-manager`, v0.1.0),
which was removed first with `uninstall.mjs --all` (`check --after-uninstall` clean, commit f372502).

## Summary

The agent manager keeps every feature, route, id and guard of the Opus build, and its **definition format becomes a
framework contract, `agent-definition@1`**: one TypeScript reference in `framework/core/agents.ts`, a Python port in the
plugin's `server/contract.py` and a Kotlin mirror in the kernel (`ai.amberx.axf.kernel.agents`), all replaying one
fixture (`framework/spec/fixtures/agents.json`). Validation, normalisation, the system-prompt composer, memory config and
text engine (tokens, BM25, chunking, trimming), workflow/tool templates, router parsing, add-on checks, risk rules and
export are now the same code path on every port, so Build Pilot and Android apps can load the same agents and
produce the same prompts. On top of that the server gained a dry-run validator (`POST /validate/{coll}`, used live by
every form — Save is disabled while the contract reports errors), streamed workflow runs (SSE) with per-step timing, a
memory-store overview, a whole-library export, forward references inside add-on bundles, a one-time data migration, and
a Safety panel that shows which dangerous tools each agent wants/gets and whether Container access + Snapshot Manager are
on. Self-tests: 92 → 116 checks, plus the fixture replay in TS (gen) and Kotlin (conformance test, written without a compiler).

## Removed
- The Opus plugin folder (every file), through its own uninstall (`uninstall.mjs --all`, no `--publish`), then rebuilt in the same folder.
- Duplicated validation logic in `server/__init__.py` (`_validate`), `toolkit.validate`, `training.validate`, the ad-hoc `_fill`/regex helpers in `engine.py`/`toolkit.py`, and the risk-stripping copies in `addons.py`/`library.py` — all replaced by the contract.
- Nothing user-visible was removed. Every route, action, dialog, settings key and data file of the Opus build still exists.

## Kept (unchanged ids and behaviour)
- Plugin id `ai.amberx.axf.console.agent-manager`, folder `agent-manager`, capability `axf.agents@1` with the same five methods and return shapes (`list_agents` + `dangerous`, `get_agent` + `voice`/`writeMode`, `run_tool` with `ctx.stage`, `memory_context`, `record_turn`); the AI assistant, systems check and feature-assist tests pass unchanged (111 / 56 / 29).
- Dialog `agent-manager.wizard` (`builder`, `agent`, `skill`, `tool`, `training`), action `agent-manager.wizard:<kind>`, view `agent-manager`, settings tab `agent-manager` with the same panels; routes `/status`, `/settings`, `/settings/test`, `/settings/test-firecrawl`, `/c/{coll}[/{id}]`, library routes (`versions`, `rollback`, `used-by`, `duplicate`, `fork`, `export`, `import`), `/draft/{coll}`, `/agents/{id}/resolved|chat|clone|export`, `/compose`, `/memory/{id}` (+ `summary`, item delete, `clear`), `/tools/{id}/test`, `/training/{id}/run`, `/workflows/{id}/run`, `/runs`, `/addons…`.
- Settings keys and file: `settings.json` (`llm`, `preferAssistant`, `firecrawl`, `defaults`, `scheduler`, `safety.dangerousAgents`), data dir layout (`agents.json` … `training.json`, `addons.json`, `runs.json`, `memory/<scope>.json`, `versions/<coll>/<id>.json`, imported `addons/`), file tags `agent-manager-<coll>@1`, `agent-memory@1`.
- `agent-addon@1` and `agent-library-item@1` formats; the three bundled add-ons (Mosses `coder` v2.0.0, `axf-expert`, `ai-expert`) byte for byte; Coder 1.x → Mosses migration with memory; exact uninstall of add-ons; training scheduler (manual/hourly/daily/weekly); workflows sequential/parallel/router/critic; memory types none/buffer/summary/keyword/vector/hybrid and kinds fact/episode/summary/knowledge/note; container tools and the Safety allow list; library features (used by, fork, duplicate, export/import, versions + diff + rollback, plain-English drafts, dangerous marking, persona samples + voice slot).
- Every guard from the security reviews (see Security).

## Changed
- **Validation** of every collection goes through `contract.validate_item` (same messages as before, e.g. "tool names must be function names", "put secrets in an environment variable"). New normalisation rules: unknown references are dropped with a *warning* (not silently), self-delegation is dropped, memory numbers must be numbers, `temperature` 0–2, `maxLoops` capped at 6, workflow step ids must be unique and are sanitised, training sources are checked per type (URL / query / globs / text / uri / tool), chunk size 300–6000 and overlap ≤ 1000 (as before).
- **System prompt** is built by `contract.compose_system_prompt` (identical text to the Opus composer; the container guide / safety note are passed as `extras`).
- **Memory trimming** uses the contract's `trim_memory` (same order: episodes first, then least used, then oldest); BM25 scores are rounded to 6 decimals on every port.
- `addons.install` validates every bundle item through the contract with a context that includes the bundle's own ids, so items may reference each other in any order (the Opus build only validated tools and training jobs); an invalid item refuses the whole install and leaves nothing behind.
- `GET /status` adds `version`, `contract`, `schedulerTick`, `memoryKinds`, `dangerousBuiltins`, `workflowModes`, `services {containers, snapshots}`, `safety.dangerousAgents`; `GET /addons` items add `risks` and `agents`; `GET /agents/{id}/resolved` adds `writeMode`, `dropped` and `dangerous` per tool; workflow traces and runs carry `ms`.
- `PUT /settings` rejects non-numeric memory defaults (400) and caps them at 50 000 (before: anything was stored).
- `POST /memory/{id}` accepts kinds fact/note/knowledge only (before: any string).
- `POST /tools/{id}/test` refuses to run change-proposing container tools outside a chat (before: the tool itself answered "Not applied"; same outcome, clearer and never reaches the proposal path).
- Agent deletion now also unlinks the agent from other agents' `delegates`.
- UI: the view follows the UI-editor rule (`plugin.json` → `uiEditor: ["builder"]`, `useEditorSync` reloads the cache when the view opens or regains focus); forms show live contract errors/warnings and disable Save on errors; the agent list shows a "dangerous tools" badge, forks show a "fork" chip, the Prompt & tools view marks dangerous tools, write mode and tools switched off by Safety; Workflows → Run streams step progress with a Stop-watching button and per-step timing; Memory tab has a kind picker for Remember and an "All memory stores" overview; Add-ons show their agents and risks; the header has **Export library** and the contract name; Settings → Safety shows the services and what each agent wants/gets.

## Added
- `framework/core/agents.ts` — the contract (exported from `framework/core/index.ts`): constants and vocabularies, `AGENT_LIMITS`, types (`AgentDef`, `SkillDef`, `PersonaDef`, `LingoDef`, `ToolDef`, `WorkflowDef`, `TrainingDef`, `MemoryItem`, `AddonBundle`, `AgentContext`), `validateAgentItem`, `validateAddon`, `resolveMemory`, `memoryTokens`, `bm25Rank`, `chunkText`, `trimMemory`, `composeSystemPrompt`, `fillWorkflowTemplate`, `parseRouterPick`, `fillToolTemplate`, `toolRisks`/`addonRisks`/`stripToolRisks`/`stripAddonRisks`, `agentToAddon`, `AgentRuntime` + `placeholderAgentRuntime`, capability id `axf.agents`.
- `framework/spec/fixtures/agents.json` (generated by `gen-fixtures.mts`): 35 validation cases, memory configs, tokens, BM25, chunks, trimming, 3 prompts, templates, router picks, tool templates, 5 bundles (risks + stripped), one export.
- Kotlin `framework/android/axf-kernel/src/main/kotlin/ai/amberx/axf/kernel/agents/Agents.kt` (data classes, `AgentValidator`, `AgentMemory`, `AgentPrompts`, `AddonRisks`, `AgentRuntime`, `PlaceholderAgentRuntime`) + `AgentsConformanceTest.kt`; `AxfKernel` declares placeholder capability `axf.agents`. Written without a compiler (Maven unreachable here).
- `server/contract.py` (Python port + `check_fixture`), `GET /contract`, `POST /validate/{coll}`, `POST /workflows/{id}/run/stream` (SSE), `GET /memory` (store overview), `GET /export` (whole library as `agent-addon@1`), `store.migrate()`, `store.known()/dangerous_agents()/memory_defaults()`, `toolkit.register_builtin()` (open registry for builtins, with a dangerous flag), `engine.resolve_tools()`, `on_event` hooks on `run_agent`/`run_workflow`.
- `hooks.mjs` check `contract-fixture`; web helpers `validate`, `isDangerousTool`, `streamWorkflow`, `useLiveCheck`, `CheckNote`.

## Contract / API / settings / fixture changes (old → new)
| What | Old | New |
|---|---|---|
| Definition format | implicit (Python validators) | `agent-definition@1` in `framework/core` + Kotlin + Python, fixture `spec/fixtures/agents.json` |
| Kernel capability | — | `axf.agents` (placeholder on Android; `axf.agents@1` is the console service) |
| plugin.json | v0.1.0, optional `axf.llm@1` | v0.2.0, optional `axf.llm@1`, `axf.containers@1`, `axf.snapshots@1`; `uiEditor: ["builder"]` |
| Routes | — | `+ GET /contract`, `POST /validate/{coll}`, `POST /workflows/{id}/run/stream`, `GET /memory`, `GET /export` |
| `GET /status` | basic | + version, contract, services, safety, dangerousBuiltins, memoryKinds, workflowModes, schedulerTick |
| Settings keys | unchanged | unchanged (defaults now bounded) |
| Data files | unchanged | unchanged; `migrate()` adds `dangerous:false` to tools and `memory:{}` to agents that lacked them |
| `agent-addon@1` | items validated partly | every item validated; forward references allowed |
| CLAUDE.md / plugins README | Opus lines | rebuilt lines (same `<!-- axf-plugin:agent-manager -->` marker) |

Compatibility: apps and plugins using `axf.agents@1` need no change. Existing `.axf-console/plugins/agent-manager/`
data loads as is. Web callers of `/c/{coll}` get the same records; new optional fields only.

## Tests
- Before: `python3 apps/console-web/plugins/agent-manager/test.py` → 92 checks passed (run on the Opus build before removal).
- After: 116 checks passed. New: contract fixture replay (Python = TS reference), `/contract`, `/validate` dry run (+404), SSE workflow run (+404), per-step timing, delegate unlink on agent delete, settings bounds (400 + cap), whole-library export, `store.migrate()` (once, idempotent), memory store overview, hand-added memory kinds, container write tool test never applies, resolved view (dropped/writeMode/dangerous), status allow list + services, add-on listing agents/risks, forward references in bundles, invalid bundle refused with nothing left, imported add-on uninstall, bundled id can't be shadowed.
- Cross-port: `npx -y tsx framework/spec/gen-fixtures.mts` regenerates `agents.json` (no other fixture changed); Kotlin `AgentsConformanceTest` replays it in CI. `framework/package.json` `tsc -p libs/tsconfig.json` passes; `apps/console-web` `tsc --noEmit` + `vite build` pass.
- Also green: `axf validate --framework`, `tracker.mjs --check`, `plugins.mjs --check`, `check-theme.mjs`, `check-project-fixtures.mjs`, `plugin-lifecycle.mjs check agent-manager`; other plugin self-tests (ai-assistant 111, systems-check 56, feature-assist 29, plugin-manager 52).

## Security
- Kept: console token on every route (console adds it), 404 when disabled, never on MCP; SSRF-safe pinned fetch with redirect re-checks, byte caps and deadlines (`safety.py` unchanged); literal-only repo search; repo path deny lists (`.git`, `.axf-console`, `.env`, keys…); `env:VAR` headers only (inline secrets refused); imported add-ons/items lose env headers, private access and MCP tokens unless trusted; a bundle can't take over another agent's memory scope; container tools are always dangerous, read-only without Snapshot Manager, proposals only through the chat's `stage`; agents never read secrets files in containers and secret-looking values are redacted; dangerous tools only for the Safety allow list, which personas/skills can't change; delegation depth ≤ 3; stored keys 0600 and never returned.
- Tightened: memory defaults bounded; hand-added memory kinds restricted; change-proposing container tools refused in the UI tester; invalid add-on items abort the install atomically; the contract caps every string/list (`AGENT_LIMITS`) on every port.

## Screenshots (web console, dark, phone + desktop)
Captured with `framework/cli/rebuild-shots.mjs` (`agent-manager-plugin/shots/shots.json`), 15 screens × 2 viewports, before = commit d2f58a9 (Opus build), after = this branch.

| Screen | Before | After |
|---|---|---|
| Agents list | ![before](agent-manager-plugin/shots/before/agents-list-phone.png) | ![after](agent-manager-plugin/shots/after/agents-list-phone.png) |
| Agent editor (Mosses) | ![before](agent-manager-plugin/shots/before/agent-editor-phone.png) | ![after](agent-manager-plugin/shots/after/agent-editor-phone.png) |
| Prompt & tools | ![before](agent-manager-plugin/shots/before/agent-prompt-desktop.png) | ![after](agent-manager-plugin/shots/after/agent-prompt-desktop.png) |
| Skills library | ![before](agent-manager-plugin/shots/before/skills-library-desktop.png) | ![after](agent-manager-plugin/shots/after/skills-library-desktop.png) |
| Tools (container_write) | ![before](agent-manager-plugin/shots/before/tools-tab-phone.png) | ![after](agent-manager-plugin/shots/after/tools-tab-phone.png) |
| Training | ![before](agent-manager-plugin/shots/before/training-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/training-tab-desktop.png) |
| Workflows | ![before](agent-manager-plugin/shots/before/workflows-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/workflows-tab-desktop.png) |
| Memory | ![before](agent-manager-plugin/shots/before/memory-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/memory-tab-desktop.png) |
| Add-ons | ![before](agent-manager-plugin/shots/before/addons-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/addons-tab-desktop.png) |
| Wizard: agent builder | ![before](agent-manager-plugin/shots/before/wizard-builder-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-builder-phone.png) |
| Wizard: new skill | ![before](agent-manager-plugin/shots/before/wizard-skill-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-skill-phone.png) |
| Wizard: new tool | ![before](agent-manager-plugin/shots/before/wizard-tool-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-tool-phone.png) |
| Wizard: training | ![before](agent-manager-plugin/shots/before/wizard-training-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-training-phone.png) |
| Settings → Safety | ![before](agent-manager-plugin/shots/before/settings-safety-desktop.png) | ![after](agent-manager-plugin/shots/after/settings-safety-desktop.png) |
| Settings → Add-on agents | ![before](agent-manager-plugin/shots/before/settings-addons-desktop.png) | ![after](agent-manager-plugin/shots/after/settings-addons-desktop.png) |

The other viewport of each pair is in the same folders. Android: no screens affected (kernel contract only, no Compose UI) — Android screenshots pending CI.

## Known gaps / placeholders
- Kotlin written without a compiler: `Agents.kt` and `AgentsConformanceTest.kt` need Android CI (check the "CI build errors" issue). The Kotlin runtime is a placeholder (`PlaceholderAgentRuntime`, capability `axf.agents`); an Android agent manager module (storage, model calls, UI) is future work (`build-pilot-agents` covers the Build Pilot side).
- The Android memory engine mirrors tokens/BM25/chunk/trim only; vector search and the LLM reflection stay host-side.
- The playground is still a non-streamed single turn; streamed chats live in the AI assistant.
- `firecrawl-*` sources, MCP sources and embeddings need keys/servers; untested here beyond the fake model.
