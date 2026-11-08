<!-- memory-chunk@1 source=_claude/memory/docs/feature-matrix.md lines=14-22 tokens=172 -->
## Files

| File | What |
| --- | --- |
| `framework/plan/feature-matrix-core.mjs` (+ `.d.mts`) | the contract: dataset shape, normalisation, `apply()` actions, `totals()`, `grid()`, seed helpers, `validate()` |
| `framework/plan/feature-matrix-apply.mjs` (+ `.d.mts`) | the Apply engine: `projectBuild / projectPending / projectQueueRecord / projectChange / projectFeature`, `applyAll()` |
| `framework/spec/fixtures/feature-matrix.json` | replay fixture: scenario → expected dataset, totals, grid; targets before/after Apply, report, second pass |
| `framework/spec/check-feature-matrix.mjs` | the check (CI, `android.yml`); `--write` regenerates the fixture from the reference cores |
