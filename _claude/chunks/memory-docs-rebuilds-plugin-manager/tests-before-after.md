<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md lines=110-124 tokens=318 -->
## Tests — before → after
- Opus plugin self-test `test.py`: **46** checks (52 with FastAPI; FastAPI route checks were skipped in this sandbox) →
  **62** checks (plus the 6 route checks when FastAPI is installed, now 7 with `GET /records`). New: fixture replay of
  the Python engine (inventory, off-provider toggle, graph, record fields), target check, `plugin:<id>` dependencies and
  dependents.
- New `framework/spec/check-plugin-inventory.mts` (fixture replay in TS, unit checks: repeated entries count once, a
  plugin never satisfies itself, live-only providers, target `*`, disabled editors don't clash; the web adapter over a real
  runtime with libraries). Passes.
- New Kotlin `PluginInventoryConformanceTest` (frame/healths/labels, full inventory replay, off-provider toggle, graph,
  record-field guard) — **written without a compiler** (Gradle can't reach the plugin portal / Maven from the sandbox);
  CI compiles it.
- Still green: `axf validate --framework` (48 assets), `tracker.mjs --check`, `plugins.mjs --check`,
  `check-theme.mjs` (187 files), `check-project-fixtures.mjs`, `tsc` for the console and `framework/libs`, Vite build of
  the console, `plugin-lifecycle.mjs check plugin-manager` (clean), `axf init` + build of react-ts and next-ts apps.
