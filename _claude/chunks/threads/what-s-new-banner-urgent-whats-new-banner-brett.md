<!-- memory-chunk@1 source=_claude/THREADS.md tokens=217 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| What's new banner (Urgent `whats-new-banner`; Brett Nov 3, voice): banner ticker + unread count of features merged to main, panel grouped by date / build / app, search, details, read marks, settings. Plugin `whats-shipped` (display name What's new; the folder name avoids the systems check's own `whats-new` strip), feed whats-new@1 from merged PRs (GitHub, else git), builds store, reports, Codebase changes; deployed from deploy.yml runs or the `site` branch. Report `_claude/builds/reports/whats-new-banner.md`. | built, PR #260 open, waiting in UI Review r-20261103-8861306a | `claude/whats-new-banner` | #260 | Brett: approve the UI Review item; later switch the feed's rebuild trigger to orch-live-sync's builds-live events once on main (seam in `Sources.fingerprint`) | 2026-11-03 |
