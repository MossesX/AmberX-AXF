<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=193 -->
## Oct 31 2026 — One builds store; the old lists are its projections (Brett, GO on the Urgent profile)
"Just do whatever you gotta do... get that done ASAP. First thing done." Master cleanup: one builds store owned by the
orchestrator (`_claude/builds/store.json`, builds@1), profiles are a field on each build, Pending is a status, the
queue is an order; every write versioned (journal); the console never re-creates the queue from the plan; old files
kept read-only (as exports) for one release; one Builds page with a Steps view (atomic step records, drag reorder,
multi-select, divide, harvest + split into N, Restore default, draft until Apply / Discard, rename) and live progress
bars per build, step and profile. Report: `_claude/builds/reports/urgent-builds.md`.
