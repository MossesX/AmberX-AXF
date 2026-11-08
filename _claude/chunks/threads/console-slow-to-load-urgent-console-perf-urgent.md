<!-- memory-chunk@1 source=_claude/THREADS.md lines=242-247 tokens=250 -->
### Console slow to load (`urgent-console-perf`, Urgent, Opus) — branch `claude/urgent-console-perf`
- **Asked (Brett, Nov 4 2026, voice):** "How come console is taking forever to load? I thought lazy loader was in." … "Can we dig into it?" … "Yes."
- **Done:** s1–s4 (store lock + export fix, server read cache + spawn cap + tini, client fetchShare + getJson fallback, reconcile throttle). Report with before/after numbers: `_claude/builds/reports/urgent-console-perf.md`.
- **Left:** s5 tail: PR CI green → auto-merge → `flock /run/axf-console-update.lock /usr/local/bin/axf-console-update` (or wait for the 5-min cron), then check `GET /api/perf`, `docker top axf-console` and the 500s are gone.
- **Checks:** `node framework/spec/check-builds-store-lock.mjs`, `python apps/console-web/server/test_readcache.py`, `cd apps/console-web && npx tsx scripts/fetch-share-check.mts`.
- **First message:** "Carry on urgent-console-perf from THREADS.md: land the PR and verify the live console numbers."
