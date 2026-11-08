<!-- memory-chunk@1 source=_claude/THREADS.md tokens=165 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Every change through a PR, pulled up to date with main before it merges (push banner 0.5.0: autoPr, no direct merges, behind → pull → wait for CI → merge, oldest first, one merge per round, branch protection on main / systems check Auto fix) (VPS build session, Refactor, Opus) | review | `claude/pr-only-merge` (on `claude/veto-everywhere` = #176) | opened through the push banner (veto call) | Merges by itself once #176 is in and CI is green; then the console redeploys and the next round opens PRs for every branch. Orchestrator build `pr-only-merge` (refactor) | 2026-10-30 |
