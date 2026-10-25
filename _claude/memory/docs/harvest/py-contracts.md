# Harvest — `py-contracts` (Fable, Oct 21 2026)

Branch `harvest/f-py-contracts`. The Python ports of the framework contracts and the Python assistant host runtime
are framework files now (`framework/python/axf/…`), not private copies inside two console plugins; `ChatContext`
gained the open `extra` bag on all three ports; the console image carries `framework/python`.

## What moved (from → to)

| Item | From | To | Notes |
| --- | --- | --- | --- |
| assistant@1 Python port (pure rules + SSE) | `apps/console-web/plugins/ai-assistant/server/contract.py` | `framework/python/axf/contracts/assistant.py` | + `normalize_chat_context`, `context_extra`, `CHAT_CONTEXT_KEYS/LIMITS`, `check_fixture` |
| agent-definition@1 Python port | `apps/console-web/plugins/agent-manager/server/contract.py` | `framework/python/axf/contracts/agents.py` | unchanged except the docstring |
| live-session@1 host side (log, reducer, `LocalHost`, `SessionHosts`, placeholder, service) | `plugins/ai-assistant/server/sessions.py` | `framework/python/axf/assistant_host/sessions.py` | `LocalHost(label=, note=, restart_reason=)`, `axhub_placeholder(runs_on=)` instead of console wording |
| provider adapters + registry loader (3 protocols, `register_protocol`, model lists, tests, embeddings, Claude Code CLI + bridge) | `plugins/ai-assistant/server/providers.py` | `framework/python/axf/assistant_host/providers.py` | console imports (`store`, `credentials`, `console_context`) replaced by host hooks (below); `AXF_PROVIDERS_FILE` override for baked schemas |
| MCP stdio bridge the CLI runs | `plugins/ai-assistant/server/cli_bridge.py` | `framework/python/axf/assistant_host/cli_bridge.py` | started by `providers._Bridge` with its own path |
| safety helpers (bounded calculator, SSRF-safe fetch) | `plugins/ai-assistant/server/safety.py` **and** `plugins/agent-manager/server/safety.py` (identical) | `framework/python/axf/assistant_host/safety.py` | one copy; `USER_AGENT` settable |

Deleted: the six plugin files above (git renames) plus the agent-manager's duplicate `safety.py`.
Not moved (console-specific, stays in the plugins): `store.py`, `tools.py`, both `__init__.py` routers, the agent
manager's engine/memory/toolkit/training/containers/addons/library/llm.

## Who uses it now

- `apps/console-web/plugins/ai-assistant/server/__init__.py`: `from axf.assistant_host import providers, sessions`,
  `from axf.contracts import assistant as contract`; sets the host hooks once at import (`providers.extra_kinds =
  store.extra_provider_kinds`, `stored_secret_names` = the console credential store's keys, `PRIVATE_ROOTS` = the
  console root, `PRIVATE_DIRS = [".axf-console"]`, `HOST_LABEL = "the console server"`) and `reload_catalog()`;
  `LocalHost(... label="This console" ...)`, `axhub_placeholder("this console")`. `tools.py` and `store.py` import
  the framework modules directly.
- `apps/console-web/plugins/agent-manager/server/*`: `from axf.contracts import agents as contract` (8 modules),
  `toolkit.py` uses `axf.assistant_host.safety`.
- Both plugin packages put `<repo>/framework/python` on `sys.path` (same pattern as the mcp-client plugin); the Docker
  image also sets `PYTHONPATH=/axf/framework/python`.
- Build Pilot: adoption steps below (its baked copies still point at the old plugin paths until re-baked).

## Contract change: `ChatContext.extra` (assistant@1)

`ChatContext { view?, title?, selection?, note?, extra?: Record<string, unknown> }` on all three ports:
- TS `framework/core/assistant.ts`: `CHAT_CONTEXT_KEYS` (`projectId`, `appId`, `path`, `route`), `CHAT_CONTEXT_LIMITS`,
  `normalizeChatContext(raw)`, `contextExtra(ctx, key)`.
- Kotlin `Assistant.kt`: `ChatContext.extra: JsonObject?`, `ChatContext.extraString(key)`, `toJson()`,
  `ChatContext.fromJson()`, objects `ChatContextKeys`, `ChatContextRules` (`normalize`). **Written without a
  compiler** — `bounded()` is an exhaustive `when` over the sealed `JsonElement` (JsonPrimitive/JsonArray/JsonObject;
  `JsonNull` is a `JsonPrimitive` and is handled first in `boundedPrimitive`). New test
  `chat context and its extra bag normalise like the reference` in `AssistantConformanceTest`.
- Python `axf.contracts.assistant`: `CHAT_CONTEXT_KEYS`, `CHAT_CONTEXT_LIMITS`, `normalize_chat_context`, `context_extra`.
- Rule (same everywhere): known fields cut to 200/300/4000/2000; `extra` keys `[A-Za-z0-9_.-]{1,64}`, ≤ 32 keys and
  ≤ 32 items per array, strings ≤ 2000, depth ≤ 4, non-finite numbers dropped, `extra` over 16 000 JSON characters
  dropped **whole**; unknown keys preserved in order; nothing left → null.
- Fixture: `spec/fixtures/assistant.json` → `chatContext` (14 cases: pass-through, unknown keys kept, bad keys,
  cuts, 32-key cap, depth, oversized, wrong shapes, non-string known fields). NaN/Infinity can't travel in JSON, so
  each port tests that rule in its own test.
- Console plugin: the turn normalises `body.context` before storing it on the message and building the system
  prompt; well-known `extra` keys are named in the "Console context" line (`projectId: apk-1`), a host's own keys
  are stored but not shown to the model. The web chat normalises before sending. No UI change.
- Spec: `framework/spec/ASSISTANT.md` (Chat context paragraph, Python hosts paragraph, table rows).

## Guards kept / tightened

- `safety.py`: the two plugin copies were byte-identical apart from the docstring; every guard kept (AST size,
  exponent and result caps, each operand evaluated once; host resolved once, `is_global` check, pinned connection,
  redirects re-checked per hop, deadline + byte cap). Build Pilot's copy differs only in the user agent.
- `providers.py` CLI guards kept and made host-driven: secret-looking env vars + hidden prefixes + the host's stored
  credential names removed from the CLI environment; relative and absolute deny rules for every `PRIVATE_DIRS` entry
  under cwd and every `PRIVATE_ROOTS()` root; the no-file-access jail unchanged. The console sets exactly what it had
  before (`.axf-console`, console root, credential store keys, `AXF_` prefix). Build Pilot's copy additionally hides
  `BP_` and `.build-pilot/`: expressed as hooks in the adoption steps below (no behaviour lost).
- `sessions.py`: unchanged logic (id sanitising, 0600 logs, owner events renamed `owner.<kind>`, Busy on a second
  turn, never writing back a closed/forgotten session).
- New: a chat context can no longer carry an unbounded payload (it was stored as-is on the message before).

## Tests

| Suite | Before | After |
| --- | --- | --- |
| `apps/console-web/plugins/ai-assistant/test.py` | 137 | 128 (fixture replays moved out: −14 assistant@1 rule checks, −4 live-session replays; +9 new: framework imports, hooks, `extra` end-to-end, host naming) |
| `apps/console-web/plugins/agent-manager/test.py` | 116 | 117 (+1 framework-import check; fixture replay kept, it's one line) |
| `framework/python/axf/contracts/test.py` (new, CI) | — | 9 (assistant@1 fixture incl. 14 chat contexts, agent-definition@1 fixture, extra rules) |
| `framework/python/axf/assistant_host/test.py` (new, CI) | — | 54 (live-session fixture + LocalHost run, providers against a fake server, CLI hooks, safety) |
| every other `plugins/*/test.py` | green | green (same numbers) |
| `server/test_*.py` (alerts, app_ci 32, plugin_catalog 19, app_catalog 15, wall_users 56) | green | green |
| `AssistantConformanceTest` (Kotlin) | 7 tests | 8 tests — compiled by CI only |
| `axf validate --framework`, `tracker --check`, `plugins --check`, `project validate --all`, `check-theme`, `plugin-lifecycle check ai-assistant|agent-manager`, `gen-fixtures` (only assistant.json changed), console `tsc` + `vite build` | ok | ok |

## Docker

`apps/console-web/server/Dockerfile`: one line changed — `ENV … PYTHONPATH=/axf/framework/python` added to the
existing `ENV AXF_CONSOLE_DIST=…` line, plus a 3-line comment above it. `framework/python` was already in the image
(`COPY --from=web /axf /axf`, repo-root context) and in the host clone mounted over `/axf`; the plugins also add the
path themselves, so the env var is belt and braces for `axf_server/` (another group adds that package; nothing else
in the Dockerfile touched, no `COPY` added).

## Left for later

- Build Pilot adoption (not done here; Build Pilot is read-only for this group): see the final message / below.
- An `axf_server/` + `axf.assistant_host` doc line in `framework/libs/README.md` once the other Python group lands.
- `providers.py` still shells out to the Claude Code CLI with `claude -p`; an axHub-hosted session host
  (`axhub-agent-host`) replaces `axhub_placeholder` by registering a `SessionHost`.
- `apps/console-web/src/axf/core/assistant.ts` was re-baked by hand (CI re-bakes the whole folder anyway).

### Build Pilot adoption steps (exact)

**Obsolete (Oct 25 2026):** Build Pilot's own assistant + agent manager were removed (Build-Pilot PR #4; the Dev
Console hosts both), so there is nothing left to adopt. Kept for history.

1. `scripts/bake-contracts.mjs` → `FILES`: replace the two plugin lines with
   ```js
   'framework/python/axf/contracts/assistant.py': 'server/axf_contracts/assistant.py',
   'framework/python/axf/contracts/agents.py': 'server/axf_contracts/agents.py',
   'framework/python/axf/assistant_host/providers.py': 'server/axf_host/providers.py',
   'framework/python/axf/assistant_host/sessions.py': 'server/axf_host/sessions.py',
   'framework/python/axf/assistant_host/safety.py': 'server/axf_host/safety.py',
   'framework/python/axf/assistant_host/cli_bridge.py': 'server/axf_host/cli_bridge.py',
   ```
   (and the header comment), add `server/axf_host/__init__.py` with the same "never edit, re-bake" note as
   `server/axf_contracts/__init__.py`, re-run `node scripts/bake-contracts.mjs --from ../amberx-axf`.
2. Delete `server/providers.py`, `server/sessions.py`, `server/safety.py`, `server/cli_bridge.py`; in
   `server/assistant.py` and `server/agents.py` import `from axf_host import providers, safety, sessions` and set the
   hooks once (what its forked copies hard-coded): `providers.extra_kinds = assistant_store.extra_kinds`;
   `providers.PRIVATE_DIRS = [".build-pilot", ".axf-console"]`; `providers.ENV_PREFIXES_HIDDEN = ["AXF_", "BP_"]`;
   `providers.PRIVATE_ROOTS = lambda: {str(Path(__file__).resolve().parent.parent), os.environ.get("BP_DATA_DIR", "")} - {""}`
   (its copy also denied `//run/console/**` and the whole `BP_DATA_DIR`: keep those by appending to the result of
   `providers._cli_abs_deny` or by adding `BP_DATA_DIR`'s folder name to `PRIVATE_DIRS`); `providers.HOST_LABEL =
   "the Build Pilot server"`; `providers.USER_AGENT = "AmberX-BuildPilot-Assistant/1"`; `safety.USER_AGENT =
   "AmberX-BuildPilot/1"`; `os.environ.setdefault("AXF_PROVIDERS_FILE", str(BP_PROVIDERS_FILE))` before importing
   providers (its copy read `BP_PROVIDERS_FILE` → baked `src/axf/schemas/ai-providers.json`); `BP_AI_TIMEOUT` /
   `BP_AI_CLI_TIMEOUT` → set `AXF_AI_TIMEOUT` / `AXF_AI_CLI_TIMEOUT` from them before import;
   `sessions.LocalHost(folder, label="Build Pilot server", note="Replies run on the Build Pilot server and keep going when the browser closes.", restart_reason="The Build Pilot server restarted while this reply was running.")`;
   `sessions.axhub_placeholder("the Build Pilot server")`.
3. `src/assistant/chat.tsx`: delete `type PilotCtx = Ctx & { projectId?: string }` and every `as PilotCtx` cast; build
   the context as `{ view: axState.view, title: document.title, extra: pilot.project?.id ? { projectId: pilot.project.id } : undefined, selection: … }`
   and read it with `contextExtra(ctx, 'projectId')` (exported by the baked `src/axf/core/assistant.ts`); the chip and
   the per-message "context:" line use the same call.
4. `server/assistant.py` line ~190: `_turn_project.set(contract.context_extra(contract.normalize_chat_context(body.get("context")), "projectId")[:64])`
   and store the normalised context on the user message (as the console does). `server/test_server.py` ~654:
   `context={"view": "designer", "extra": {"projectId": "apk-1"}}`.
5. Run `node scripts/bake-contracts.mjs --check`, `python3 server/test_server.py`, `npm run typecheck`.
