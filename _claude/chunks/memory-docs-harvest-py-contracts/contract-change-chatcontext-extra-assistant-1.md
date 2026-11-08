<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md tokens=493 -->
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
