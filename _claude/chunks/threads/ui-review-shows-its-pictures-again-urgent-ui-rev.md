<!-- memory-chunk@1 source=_claude/THREADS.md tokens=237 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| UI Review shows its pictures again (Urgent `ui-review-shots`, Opus, agent Snap Sully; Brett Nov 3 voice: "items but NO pictures"): files were all on disk and served 200; two console pollers (agent-slots, token-control pass) re-subscribed on every render and fired ~45 status calls/s, starving the picture fetches; on phones a today-made selector (`:where(:not([data-fx-narrow]))`, always true) squeezed the preview to zero width. Fixed both + layout-adopt codemod, shot timeout/retry, "Shot missing" + Re-capture, health@1 `ui-review-shots`, `review.mjs` worktree warning | review (all 5 steps done; PR open, UI Review waiting) | `claude/ui-review-shots` | [#277](https://github.com/MossesX/AmberX-AXF/pull/277) | Report `_claude/builds/reports/ui-review-shots.md`. Console redeploy (on merge) stops the storm. Brett: approve UI Review r-20261103-17ef4a40 | 2026-11-03 |
