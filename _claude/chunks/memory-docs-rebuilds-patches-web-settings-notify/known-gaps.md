<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-web-settings-notify.md tokens=141 -->
## Known gaps

- Kotlin written without a compiler (no Gradle plugin access here): CI is the compiler; check the "CI build errors" issue.
- On Android, Patches' app menu is the static asset (the app-menu engine's Android twin is still deferred).
- The console's web push / ntfy still reach the phone too: turn them off in the console (Settings → Alerts) if
  Patches' notifications are enough.
- Web Patches takes only `settings` (browsers keep their own notifications).
- The Fable rebuild (pending `patches-web-settings-notify`) redoes the contract + bridges.
