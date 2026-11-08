<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md tokens=283 -->
## Tests
- Before: Opus `test.py` 111/111 (fake providers, fake CLI, uvicorn hang-up test).
- After: `test.py` **137/137** — the 111 kept, plus: catalog = shared registry, protocols, `/contract`, 12 contract
  fixture checks (redaction, history windows, orphan tool results, chain, permissions, user settings, clamps, titles,
  summaries, owner kinds, SSE, backoff), tags listed/filterable, txt export, interrupted reply keeps its text (and
  only once), external host via `axf.live-host@1` (active, no fallback notice, reply runs there), `register_host` /
  unregister through `axf.live-sessions@1`, per-user usage, schema version, lifecycle files.
- Kotlin `AssistantConformanceTest` (6 tests over the same fixture) — written without a compiler; `KernelTest`/
  `LiveSessionConformanceTest` untouched.
- Also run: `tsc --noEmit` + `vite build` (console), `check-theme` (186 files), `axf validate --framework`,
  `tracker --check`, `plugins --check`, `plugin-lifecycle check ai-assistant` (clean), `check-alerts`,
  `check-project-fixtures`, `gen-fixtures`, the five dependent plugins' self-tests, console API boot with the plugin.
