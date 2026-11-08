<!-- memory-chunk@1 source=_claude/memory/docs/harvest/hub-notify.md tokens=279 -->
## What AXHub's ApprovalWatchService still owns (for the Fable `x.work` group)
1. Foreground service lifecycle: `startForeground(ID_WATCH, …, FOREGROUND_SERVICE_TYPE_SPECIAL_USE)` with the manifest `specialUse` subtype property; quiet stop when Android refuses a background start.
2. The polling loop: `HubClient.Default.feed(prefs.base)` → `HubState.update` → `prefs.track(ids)` → clear gone alerts / alert fresh ones → update the ongoing notification; interval `prefs.intervalSec` (15–300 s), **5 min back-off when signed out / not admin**, a one-time "sign in" notice per signed-out spell.
3. Start/stop/check-now intents (`ACTION_STOP`, `ACTION_CHECK_NOW`), `START_STICKY`, stop when watching is off, `HubState.setRunning`.
4. `WatchBootReceiver`: restart after `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED` when watching is on.
A framework work piece would take: a periodic job spec (interval, back-off rule from the job result), a foreground-service host with a notification provider (lib-notifications `ongoing`), boot/update restart, and the job body = steps in (2), which only call lib-hub + lib-notifications.
