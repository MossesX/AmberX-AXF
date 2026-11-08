<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md lines=118-129 tokens=158 -->
## Tests

| | Before | After |
| --- | --- | --- |
| `check-embed.mts` | — | 94 |
| `check-widgets` / `check-appearance` / `check-app-menu` / `check-hub` | 215 / 74 / 113 / 183 | same |
| `axf validate --framework` | 66 assets | 66 |
| `axf validate apps/patches` | — | 69 assets |
| `axf project validate --all` | 6 projects | 7 |
| console `tsc --noEmit`, `vite build`, `menu-reach.mts` (165), `check-theme` (272 files) | pass | pass |
| Kotlin: `ConformanceTest` (hide forced cases), `EmbedConformanceTest` (engine + runtime), lib-hub, apps/patches | written without a compiler | CI compiles; check the "CI build errors" issue |
