# Build notifications: one notification per build, an alert on every stage

Build `build-notifications-same-notification-per-build` · Opus · branch `claude/build-notifications-same-notification-per-build`

## Asked (Brett, Nov 10 2026, verbatim)
> It's the same notification, but I want an alert each time at least.

## Built
- **One notification per build.** The dispatcher's start, end and failure alerts share one key, `pipeline:run:<id>` (`pipeline-core.mjs` `RUN_KEY`). Before this change the end used a separate `pipeline:end:<id>` key. The bell, Web Push (same tag) and AmberX (same `console:<key>` notification) now update one entry in place.
- **An alert on every stage.** A follow-up raise on an open key counted as a `repeat`: it bumped the count, stayed read and was not pushed. `alertCalls()` now closes the build's notification first and then raises the new stage. The hub records `reopened`, so the entry is unread again, goes out on ntfy / Web Push (Web Push uses `renotify` on the same tag), and AmberX sees a new `key@lastAt` stamp.
- **Stage fields.** `meta.stage` is one of started / built / requeued / returned / failed. `meta.notifyType` keeps each stage under its own Notifications type (`pipeline.launched`, `pipeline.ended`), so start and end can still be switched off separately. `meta.realert: true` marks an update that has to sound again.
- `notify.json`: "Build started" is now pushed to the phone (`push: true`, priority high). Before, it was turned off for AmberX.
- No engine change: the existing hub semantics (resolve, then raise = reopened) do the work, so the alerts engine, its TS/Kotlin twins and the fixture are unchanged.

## Open: AmberX app (deferred, Android on hold)
AmberX posts console alerts with `setOnlyAlertOnce(true)` (`WatchService.consoleAlert`). The phone re-posts the same notification on every stage. If the previous stage's notification is still on the screen, the update is silent. If Brett swiped it away or tapped it, the next stage alerts normally. The fix is a few lines of Java: use `setOnlyAlertOnce(false)` when `meta.realert` is true. It also needs a new APK. This is recorded in `framework/spec/PORTING.md`. Web Push and ntfy alert on every stage now.

## Stages not yet raised
The dispatcher knows started and ended. "Ready to merge", "merged" and "live" are not raised by anyone yet; the queued build `amberx-build-notifications-for-every-stage-start` adds them. It only has to call `alertCalls()` with a new stage (add it to `STAGE_TYPES`) to get the same one-notification re-alert.

## API
This build adds no UI. Per-type control already exists in the Notifications control panel: REST `/api/plugins/notify-control`, MCP plugin command, CLI, and AmberX voice through the console actions. Build alerts are readable at `GET /api/alerts` (`meta.stage`).

## Tests
- `build-orchestrator/pipeline.test.mjs` 46 ✓ (new: one key per build, stage meta, close-then-raise order, non-stage alerts unchanged)
- `server/test_alerts.py` ✓ (new `check_stage_realert`: a bare repeat stays silent; close + raise = reopened, unread, pushed, same key updated in place)
- `build-orchestrator/test.mjs` 33 ✓, `build-orchestrator/test.py` 37 ✓, `notify-control/test.py` 132 ✓
