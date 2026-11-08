<!-- memory-chunk@1 source=_claude/THREADS.md tokens=230 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| axHub web approvals screen flicker (Brett, phone: whole screen flashing "Reading the hub" during a veto countdown): the waiting screen only before the first look read, look applied once per real change, blips keep the list, rows memoised so the countdown ticks only its number; same for AmberX's hub view (VPS headless, Opus) | blocked | `claude/axhub-web-flicker` (merged with main, all local checks green; not pushed: the VPS GitHub token is dead, 401) | — | **To carry on:** once a new GITHUB_TOKEN is in the console Keys banner: `cd /root/axf-builds/flicker && git fetch && git merge origin/main && (cd apps/axhub-web && npx tsx scripts/refresh-check.mts) && git push origin HEAD:main`. Banner item `blocked:push-axhub-web-flicker`. Report `_claude/builds/reports/axhub-web-flicker.md`; Kotlin twin deferred (PORTING.md) | 2026-11-01 |
