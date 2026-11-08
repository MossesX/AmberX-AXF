<!-- memory-chunk@1 source=_claude/memory/docs/walkthrough-studio.md lines=59-62 tokens=59 -->
## Tests
`npx -y tsx apps/walkthrough-studio/test.mts` (38: seed coverage, moves, trash/restore, incremental compile, exports,
round trip) + typecheck/build in CI (`android.yml`). Checked with `check-theme.mjs` and `check-controls.mjs`.
