<!-- memory-chunk@1 source=_claude/memory/docs/harvest/web-client.md lines=46-59 tokens=318 -->
## Tests before → after

| Check | Before | After |
|---|---|---|
| `axf validate --framework` / tracker `--check` / `plugins.mjs --check` / `project.mjs validate --all` / `check-theme` (206 → 208 files) / project fixtures | pass | pass |
| `check-alerts` / `check-widgets` 93 / `check-mcp` 164+210 / `check-plugin-inventory` / MCP Python 210 / plugin catalog 27 | pass | pass |
| `check-web-client.mts` (new) | — | 616 |
| Kotlin `CatalogConformanceTest` (new) | — | 8/8 with a local kotlinc 2.0.21 + kotlinx-serialization 1.6.2 + JUnit 4 (explicit-API mode); `ConsoleRepo.kt` compiled against it with Context/JsonDocumentStore stubs. The Compose views are written without a compiler: CI compiles them |
| Python: server tests + 13 plugin `test.py` | all pass except `test_wall_users` (no dist) | all pass, incl. `test_wall_users` 56 (dist built); ai-assistant failed once on "closed session's log removed" (server-side timing, untouched code) then passed 4/4 |
| plugin-lifecycle check (16 plugins) | clean | clean |
| console `tsc --noEmit` + `vite build`; `framework` `npm run check:libs` | pass | pass |
| `axf validate apps/console-web` / `apps/console` | valid | valid |
| `axf init … --boilerplate apiclient` (android-compose, react-ts) | — | ok (manifest only) |
