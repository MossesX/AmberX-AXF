<!-- memory-chunk@1 source=_claude/memory/docs/harvest/work-watcher.md tokens=337 -->
## Tests before → after
- Before: `check-hub.mts` 183, `check-widgets` 93, `check-mcp` 210, alerts + plugin-inventory + project fixtures 16 all
  passing; AXHub unit tests 2 (`AlertsTest`); validate --framework 48, tracker/plugins/project/check-theme (208) clean;
  gen-fixtures stable.
- After: all of the above unchanged + **`check-work.mts` 129** (new, in CI), kernel **`WorkConformanceTest` 4** (new; run
  locally with kotlinc: 4/4), lib-work **`JobRunnerTest` 4** (new, coroutines-test; `JobRunner` compiled locally and
  smoke-run with real coroutines: notices once per spell, check-now interrupts a sleep, stop cancels, condition stop),
  AXHub **`ApprovalWatchTest` 2** (new) + `AlertsTest` 2. Console `tsc --noEmit` + `vite build` clean; plugin-lifecycle
  check clean for every plugin; `validate apps/axhub-android` 49 assets, `validate apps/console-web` 49.
- Written without a compiler: `lib-work`'s Android host (`PollJobs.kt`, `PollService.kt`, `WorkModule.kt`), `JobRunnerTest`,
  AXHub's `ApprovalWatch.kt` + `ApprovalWatchTest` (CI compiles: `:lib-work:testDebugUnitTest`, `:app:testDebugUnitTest`).
  Points to watch in CI: the manifest merge of the app's `<service android:name="ai.amberx.axf.work.PollService">`
  (property child only) with the library's declaration; `kotlin.coroutines.coroutineContext` inside `scope.launch`.
