<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md lines=134-142 tokens=161 -->
## Known gaps / placeholders
- `axhub` session host is a `PlaceholderHost` until axHub's workers provide `axf.live-host@1`.
- Resuming a reply mid-generation after a restart: the text is kept and "Continue" asks the model to carry on; the
  model run itself isn't resumed.
- Android: `Assistant.kt` ships types, rules, SSE and the `AssistantClient` interface; no implementation or UI.
  Kotlin written without a compiler — check the "CI build errors" issue.
- Build Pilot has not yet been switched to `HttpAssistantClient` (pending `build-pilot-agents`).
- Migration runner has no steps (formats unchanged); the first format change adds one.
