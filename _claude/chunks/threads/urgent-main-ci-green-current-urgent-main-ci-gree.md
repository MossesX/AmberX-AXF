<!-- memory-chunk@1 source=_claude/THREADS.md tokens=235 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| URGENT main CI green (Current `urgent-main-ci-green`, Opus; agent Earl the Ear, headless): main red on 4 jobs (7 failures, 3 hidden behind the first). Root causes: gen-fixtures.mts imported WIDGET_TYPES/TONES from widgets and chrome (chrome shadowed, widgets.json wrong → check-widgets + Kotlin ConformanceTest); xLayout `opens: false` with a view; KernelTest expected the old thin banner; repo profiles.json missing `current`; deploy test.sh used empty commits after the `_claude`-only skip; 4 unmarked build-orchestrator references (lifecycle). Plus s4: ci-main check names failing jobs, Auto fix queues new `ci-fix` job (Greenlight Gina) | review (auto-merge once green) | `claude/urgent-main-ci-green` | #284 | After merge: update waiting PRs (#265 #266 #268 #269 #271 #279) from main. Report `_claude/builds/reports/urgent-main-ci-green.md` | 2026-11-03 |
