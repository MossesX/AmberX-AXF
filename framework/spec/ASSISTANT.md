# AI assistant — `assistant@1`

**Rule (Brett, Oct 2026):** the assistant is cross-app. Every AXF app that ships an assistant (the Dev Console and
Build Pilot today, Android later) shares one contract; the chat engine lives in a host module, the UI in the app.

## Contract

| Piece | Web (reference) | Kotlin kernel | Python (console plugin) |
| --- | --- | --- | --- |
| Provider registry | `framework/schemas/ai-providers.json` (`ai-providers@1`), imported by `core/assistant.ts` | same file as a kernel resource (`ProviderRegistry`) | `providers.py` reads the file + `<dataDir>/providers.json` |
| Types, pure rules, SSE, live-reply fold, client | `framework/core/assistant.ts` | `ai.amberx.axf.kernel.assistant` (`Assistant.kt`) | `contract.py` (rules + SSE) | <!-- axf-plugin:ai-assistant -->
| Conformance | `spec/fixtures/assistant.json` (from `gen-fixtures.mts`) | `AssistantConformanceTest` | `test.py` replays the same fixture |

- **Providers:** `{kind, label, protocol, baseUrl, keyEnv, auth, models, keyUrl, vision, tools, local, note, noModelList,
  noStreamUsage, maxTokensField, headers, embedModel}`. Protocols are an open set (`openai`, `anthropic`, `claude-cli`;
  a module registers more by name). The registry is open: an app merges its own kinds on top (same id replaces).
- **Canonical message:** `{role: user|assistant|tool|system, content, images?, tool_calls?, thinking_blocks?, tool_call_id?, is_error?}`.
- **Provider events:** `text`, `thinking`, `thinking_block`, `tool_call`, `tool_done`, `usage`, `status`, `stop`.
- **Conversation (`ai-conversation@1`):** `{id, title, createdAt, updatedAt, pinned, archived, tags, settings, messages, owner?}`;
  settings keys `profileId, model, temperature, max_tokens, top_p, systemPrompt, agentId, tools, thinking`.
- **Turn events** (owner kinds on a live session, never a reserved lifecycle kind): `start`, `text`, `thinking`,
  `status`, `tool` (phase call|result), `batch`, `error`, `done`.
- **Pure rules** (fixture-checked on every port): `redactSecrets`, `wireHistory(msgs, limit)`, `profileChain`,
  `settingsAllowedFor(admin, can)`, `permissionAllows` (`a.b.*`, `*`), `clampUserParams` (256…4096, …16384 with
  `assistant.models`; thinking off without it), `batchTitle`, `summarizeArgs`, `titleFromText`, `ownerKind`,
  `reconnectDelayMs` (1 s, 2 s, 4 s … 30 s, 8 attempts), SSE `parseSseText` / `frameToEvent` / `sseLine`,
  `applyStreamEvent` (the live-reply fold).
- **Client:** `AssistantClient` (status, conversations CRUD, fork, deleteMessage, `send`, `follow`, `session`, `stop`,
  `closeSession`) — transport-agnostic; `HttpAssistantClient` speaks the reference HTTP + SSE API. `watchReply` runs a
  reply as a live session: `send` only watches, reattach by seq after drops, aborting detaches without stopping anything.
- Reference API today: the console plugin's routes under `/api/plugins/ai-assistant/`. <!-- axf-plugin:ai-assistant -->
- **Capabilities:** the engine provides `axf.llm@1` (`profiles()`, `complete()`, `embed()`) and `axf.live-sessions@1`;
  hosts come from `live-session@1` (`framework/spec/LIVE-SESSIONS.md`).

## Hosts of the engine

| App | Engine | UI | Status |
| --- | --- | --- | --- |
| Dev Console (web) | `apps/console-web/plugins/ai-assistant/server` | plugin web part on `HttpAssistantClient` | **built** (Fable rebuild Oct 20 2026) | <!-- axf-plugin:ai-assistant -->
| Build Pilot | its own engine on the baked contract (`scripts/bake-contracts.mjs`; `server/assistant.py`, routes `/api/assistant/*`) | its own, on `HttpAssistantClient` | **built** (Fable rebuild `build-pilot-agents`, Oct 20 2026) |
| Android | a module implementing `AssistantClient` (HTTP/AXPP/in-process) | Compose | planned (kernel contract only) |

## Not yet

- Android `AssistantClient` implementation and Compose chat UI.
- An in-process web engine (providers in the browser) for apps without a server.
