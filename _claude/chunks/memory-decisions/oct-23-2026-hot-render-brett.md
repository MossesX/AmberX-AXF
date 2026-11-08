<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=98 -->
## Oct 21 2026 — the axHub web app is an AXF developer app (Opus)

- **Oct 23 2026 — Hot render (Brett):** "Whenever settings are changed that affect the UI, hot render immediately" (e.g. showing/hiding a banner from settings). Every settings change re-renders the app at once (runtime state bump), in every frame/tab of the app (storage events). Web built; Kotlin twin deferred (PORTING.md).
