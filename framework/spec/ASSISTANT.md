# AI assistant — `assistant@1`

**Rule (Brett, Oct 2026):** the assistant is cross-app. Every AXF app that ships an assistant (the Dev Console and
Build Pilot today, Android later) shares one contract; the chat engine lives in a host module, the UI in the app.

## Contract

| Piece | Web (reference) | Kotlin kernel | Python (`framework/python`) |
| --- | --- | --- | --- |
| Provider registry | `framework/schemas/ai-providers.json` (`ai-providers@1`), imported by `core/assistant.ts` | same file as a kernel resource (`ProviderRegistry`) | `axf.assistant_host.providers` reads the file (`AXF_PROVIDERS_FILE` overrides) + the host's `extra_kinds()` |
| Types, pure rules, SSE, live-reply fold, client | `framework/core/assistant.ts` | `ai.amberx.axf.kernel.assistant` (`Assistant.kt`) | `axf.contracts.assistant` (rules + SSE + chat context) |
| Host runtime (not part of the contract, but what every Python host shares) | — | — | `axf.assistant_host`: `providers` (3 protocols + `register_protocol`), `sessions` (live-session@1 `LocalHost`, `SessionHosts`), `safety` (calculator, SSRF-safe fetch), `cli_bridge` |
| Conformance | `spec/fixtures/assistant.json` (from `gen-fixtures.mts`) | `AssistantConformanceTest` | `framework/python/axf/contracts/test.py` replays the same fixture; `axf/assistant_host/test.py` replays `live-session.json` (both in CI) |

- **Providers:** `{kind, label, protocol, baseUrl, keyEnv, auth, models, keyUrl, vision, tools, local, note, noModelList,
  noStreamUsage, maxTokensField, headers, embedModel}`. Protocols are an open set (`openai`, `anthropic`, `claude-cli`;
  a module registers more by name). The registry is open: an app merges its own kinds on top (same id replaces).
- **Canonical message:** `{role: user|assistant|tool|system, content, images?, tool_calls?, thinking_blocks?, tool_call_id?, is_error?}`.
- **Provider events:** `text`, `thinking`, `thinking_block`, `tool_call`, `tool_done`, `usage`, `status`, `stop`.
- **Conversation (`ai-conversation@1`):** `{id, title, createdAt, updatedAt, pinned, archived, tags, settings, messages, owner?}`;
  settings keys `profileId, model, temperature, max_tokens, top_p, systemPrompt, agentId, tools, thinking`.
- **Turn events** (owner kinds on a live session, never a reserved lifecycle kind): `start`, `text`, `thinking`,
  `status`, `tool` (phase call|result), `batch`, `error`, `done`.
- **Chat context** (`ChatContext`, what a turn carries about where it was sent from): `view`, `title`, `selection`, `note`
  and **`extra`**, an open bag for host-specific context so a host never needs a one-off field. Well-known keys
  (`CHAT_CONTEXT_KEYS` = Kotlin `ChatContextKeys` = Python `CHAT_CONTEXT_KEYS`): `projectId` (the project the chat is
  about — Build Pilot), `appId`, `path`, `route`; any other key passes through untouched, in order. Every port applies
  `normalizeChatContext` (= `ChatContextRules.normalize` = `normalize_chat_context`) before storing or using one:
  known fields cut to 200/300/4000/2000 characters; `extra` keys match `[A-Za-z0-9_.-]{1,64}`, at most 32 keys (and
  32 items per array), strings cut to 2000, depth ≤ 4, non-finite numbers dropped, and an `extra` over 16 000 JSON
  characters is dropped **whole** (never truncated into a different meaning); nothing left → no context. Hosts read a
  well-known value with `contextExtra(ctx, 'projectId')` (= `ChatContext.extraString` = `context_extra`). Fixture
  `chatContext` cases: pass-through, unknown keys preserved, bad keys, cuts, 32-key cap, depth, oversized, wrong shapes.
- **Pure rules** (fixture-checked on every port): `redactSecrets`, `wireHistory(msgs, limit)`, `profileChain`,
  `settingsAllowedFor(admin, can)`, `permissionAllows` (`a.b.*`, `*`), `clampUserParams` (256…4096, …16384 with
  `assistant.models`; thinking off without it), `batchTitle`, `summarizeArgs`, `titleFromText`, `ownerKind`,
  `reconnectDelayMs` (1 s, 2 s, 4 s … 30 s, 8 attempts), SSE `parseSseText` / `frameToEvent` / `sseLine` (framing lives in `core/sse.ts` since Oct 2026, shared by every web app; re-exported here unchanged),
  `applyStreamEvent` (the live-reply fold).
- **Client:** `AssistantClient` (status, conversations CRUD, fork, deleteMessage, `send`, `follow`, `session`, `stop`,
  `closeSession`) — transport-agnostic; `HttpAssistantClient` speaks the reference HTTP + SSE API. `watchReply` runs a
  reply as a live session: `send` only watches, reattach by seq after drops, aborting detaches without stopping anything.
- Reference API today: the console plugin's routes under `/api/plugins/ai-assistant/`. <!-- axf-plugin:ai-assistant -->
- **Python hosts** import the framework packages (`framework/python` on `PYTHONPATH`; the console image sets it, the
  console plugins add it to `sys.path` as `axf_libs.mcp` users do) and set the host hooks once at start:
  `providers.extra_kinds`, `providers.stored_secret_names`, `providers.PRIVATE_DIRS` / `PRIVATE_ROOTS` /
  `ENV_PREFIXES_HIDDEN` (what the Claude Code CLI may never see), `providers.HOST_LABEL`, `providers.USER_AGENT`,
  `sessions.LocalHost(folder, label=…, note=…, restart_reason=…)`, `sessions.axhub_placeholder(runs_on=…)`. A host
  never copies these modules; Build Pilot bakes them with `scripts/bake-contracts.mjs` from `framework/python`.
- **Capabilities:** the engine provides `axf.llm@1` (`profiles()`, `complete()`, `embed()`) and `axf.live-sessions@1`;
  hosts come from `live-session@1` (`framework/spec/LIVE-SESSIONS.md`).

## Hosts of the engine

| App | Engine | UI | Status |
| --- | --- | --- | --- |
| Dev Console (web) | `apps/console-web/plugins/ai-assistant/server` on `axf.assistant_host` | plugin web part on `HttpAssistantClient` | **built** (Fable rebuild Oct 20 2026; on the framework packages since the Oct 21 2026 harvest) | <!-- axf-plugin:ai-assistant -->
| Build Pilot | its own server on baked copies of `axf.contracts` + `axf.assistant_host` (`scripts/bake-contracts.mjs`; `server/assistant.py`, routes `/api/assistant/*`) | its own, on `HttpAssistantClient` | **built** (Fable rebuild `build-pilot-agents`, Oct 20–21 2026); re-bake from `framework/python` pending |
| Android | a module implementing `AssistantClient` (HTTP/AXPP/in-process) | Compose | planned (kernel contract only) |

## Not yet

- Android `AssistantClient` implementation and Compose chat UI.
- An in-process web engine (providers in the browser) for apps without a server.
