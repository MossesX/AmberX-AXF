<!-- memory-chunk@1 source=_claude/memory/docs/harvest/work-watcher.md tokens=422 -->
## Guards kept or tightened
Kept, one for one: never over the lock screen and lock-screen text only "Approval waiting" (unchanged `Alerts.kt` + channel
PRIVATE), `FLAG_SECURE` (MainActivity untouched), session never backed up (backup rules untouched), the `axhub_watch` prefs
file, 15–300 s interval clamp (now data in the spec, same numbers), **5-min back-off while signed out or not admin**,
one sign-in notice per signed-out spell (same single notice id for both outcomes, so not-admin after signed-out stays quiet
exactly like the old single flag), stop at the next wake when watching is off, quiet stop when Android refuses a
foreground start, `START_STICKY`, boot/update restart only when watching, the service never exported, the receiver never
exported, feed read only through lib-hub (redirects refused, 256 KB cap, hub links only).
Where the old and new copies differ (all stricter or equal):
- A job's spec is **validated at registration** (`PollJobs.register` throws on a bad spec) — the old loop had no checks.
- An unknown condition kind **never holds** (fail closed) instead of being ignored.
- A body that throws becomes outcome `error` (fallback rule = the interval) instead of crashing the service.
- A fresh start (idle/stopped → running) resets the notice spell, matching the old behaviour where a new Service instance
  reset `signedOutAlerted`.
- `onNoticesCleared` is a hook only; AXHub keeps not cancelling the sign-in notice on OK (same as before).
- The ongoing notification is rebuilt from the job state after every run by the service (`status` effect), no longer by
  the body; the text is identical (count, or the signed-out / not-admin / unreachable notes).
