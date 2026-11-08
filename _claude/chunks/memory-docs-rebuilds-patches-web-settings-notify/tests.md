<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-web-settings-notify.md tokens=109 -->
## Tests

| Suite | Before | After |
| --- | --- | --- |
| `framework/spec/check-embed.mts` | 94 | 236 |
| check-app-menu / check-widgets / check-hub / check-appearance | 113 / 215 / 183 / 74 | unchanged, pass |
| Kotlin `EmbedTakesConformanceTest` | — | new (CI) |
| axHub `pnpm test` | 321 | 326 |
| Build Pilot server self-test / contract tests | 283 / 16 | 283 / 16 |
| console typecheck + build + menu-reach (165) | pass | pass |
