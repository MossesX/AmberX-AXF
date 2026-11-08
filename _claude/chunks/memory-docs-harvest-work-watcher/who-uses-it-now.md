<!-- memory-chunk@1 source=_claude/memory/docs/harvest/work-watcher.md tokens=160 -->
## Who uses it now
- **AXHub app**: `App.modules()` adds `WorkModule(jobs = listOf(ApprovalWatch.job(this)))` (+ `WorkModule.placeholders()`);
  `ApprovalsView` and `AppModule` call `ApprovalWatch.start / stop / setInterval` (→ `PollJobs`); the running state is
  still `HubState.watcherRunning` (mirrored through `onRunning`). `axf.manifest.json` lists `ai.amberx.axf.work`
  (modules + `$installed`, `libraries.work`). Prefs file `axhub_watch` untouched, so watching / interval / full-screen /
  seen ids carry over.
- No web app uses a timer host yet; the engine is in `framework/core` (and the console's baked copy) for the next one.
