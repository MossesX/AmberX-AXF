<!-- memory-chunk@1 source=_claude/THREADS.md tokens=171 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Console slow to load (Urgent `urgent-console-perf`, Opus; Brett Nov 4 voice: "How come console is taking forever to load? I thought lazy loader was in."): /api/build-queue 500 (store lock + never-recorded export = every read took the write lock), node spawned per read per client, client fell back to stale /data on any 5xx, zombies, reconcile storms | PR open | `claude/urgent-console-perf` | (opening) | CI → auto-merge → console auto-update (flock); measured 6-round load: CPU 112 → 11.5 s, peak node 35 → 4, round 10–18 → 0.7–2.6 s. Report `_claude/builds/reports/urgent-console-perf.md` | 2026-11-04 |
