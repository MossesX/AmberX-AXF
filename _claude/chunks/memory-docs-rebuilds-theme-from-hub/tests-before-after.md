<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md lines=80-87 tokens=111 -->
## Tests before → after

- axHub: 302 → 311 (data-api 9).
- AmberX web: + `check-appearance.mts` 74; `check-theme` 209 files, console `theme-swap` green, console tsc/vite build
  green, `test_wall_users.py` 56; Kotlin: kernel compiles with explicit API, `AppearanceConformanceTest` 3/3 locally,
  `lib-hub` test written for CI (MockWebServer).
- Build Pilot: contract tests 14, server self-test 282, build + typecheck green, lock checks green.
