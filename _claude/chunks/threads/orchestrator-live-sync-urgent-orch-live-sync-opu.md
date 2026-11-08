<!-- memory-chunk@1 source=_claude/THREADS.md lines=97-97 tokens=225 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Orchestrator live sync (Urgent `orch-live-sync`, Opus, 7 steps; Brett Nov 3, voice: "every completed step must reach the orchestrator and appear on main immediately"): store writes go live to main as status-only commits (`framework/cli/builds-live.mjs`), newer-wins merge, `built` = awaiting merge, reconciler (`builds-reconcile.mjs`, session start + 10-min cron), banner item `builds-live`, THREADS Live build log | review (all 7 steps done; PR open, the push banner merges it) | `claude/orch-live-sync` | [#255](https://github.com/MossesX/AmberX-AXF/pull/255) | Backfill live on main: dock-engine/token-control/theme-editor built, urgent-builds archived, xlayout 12/12; reconciler fixed 43 builds; 28 orphan PRs + 2 branches flagged. Report `_claude/builds/reports/orch-live-sync.md`. Brett: none needed | 2026-11-03 |
