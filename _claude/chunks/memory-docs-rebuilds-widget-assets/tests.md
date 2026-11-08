<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/widget-assets.md tokens=105 -->
## Tests
- Before (Opus): see banner report; `widgets.json` 5 sections, replayed only by the (never compiled) Kotlin test.
- After: `check-widgets.mts` 93 checks (web); Kotlin engines compiled with standalone kotlinc 2.0.21 + stub and replayed banner/widgets/search fixtures: 88 checks ok; `tsc` clean, vite build ok, all CLI checkers pass (see banner report). Kotlin UI/runtime/tests: parse-checked; full compile on CI.
