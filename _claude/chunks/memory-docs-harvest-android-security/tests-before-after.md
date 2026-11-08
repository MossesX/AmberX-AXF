<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md lines=63-72 tokens=162 -->
## Tests before → after
| Suite | Before | After |
|---|---|---|
| `:lib-lock:testDebugUnitTest` (CI) | 2 | 18 (LockGateTest 10, LockGuardsTest 6, PinHasherTest 2) — run locally with kotlinc: 18/18 |
| `:lib-voice:testDebugUnitTest` (CI) | 4 | 7 (SpokenTextTest 3 run locally: 3/3) |
| `axf validate --framework`, `tracker --check`, `plugins --check`, `project validate --all` (6), `check-theme` | pass | pass |
| `axf validate apps/axhub-android|voicevault|console` | pass | pass |
| `gen-fixtures` | clean | clean |
| `axf init --template android-compose --boilerplate voice` | n/a | passes validation, installs VoiceModule + LockModule(this) |
