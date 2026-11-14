# Land on finish: auto-land live, clear backlog

Build `land-finish-auto-land-live-clear-backlog`. Brett, Nov 14 2026 22:17: "We need to make sure things are landing as
soon as they're built and merged as soon as they're built. I keep getting too many commits behind"

Branch `claude/land-finish-auto-land-live-clear-backlog`, PR #678.

## Findings: the finished-but-unlanded landing builds (s3)

Audited against `origin/main` on Nov 14 2026.

| Build | Branch | PR | Behind / ahead of main | What it adds |
|---|---|---|---|---|
| auto-land-every-finished-build-lands | `claude/auto-land-every-finished-build-lands` | #660 (open) | 561 behind / 16 ahead | Auto-land on by default with a per-build switch; land on finish (`land/hook.mjs`, build-hook listener); one serial landing line with a lock and ref-lock retry; P0 "merge main and land" fix build on clash or red; running builds get main merged every 30 min (`refreshRunning`); a 10-minute sweeper; Landing chip and line in the banner (`web/landing.tsx`); REST, MCP, CLI and voice for sweeper status / pause / resume; help and Shipped features |
| auto-land-merge-main-land-land-mjs-clash | same branch as above (it fixed the land.mjs clash in place) | #660 | (same) | Kept main's `resolveConflicts` (generated-files@1) inside the branch's `mergeMain({ inPlace })`; the sweeper merges main again with regeneration before filing a fix build when a clash is only in generated or data files |
| replace-merge-queue-one-time-landing | `claude/replace-merge-queue-one-time-landing` | #677 (open) | 53 behind / 3 ahead | `landing-line@1` pure core (`framework/core/landing-line.mjs`): states waiting → merging-main → regenerating → checking → landing → landed / fix-filed / skipped / paused, one entry in flight, cancelled / superseded / stale CI is a re-run never a failure, red files a fix and the line moves on; schema, merge-queue@1 migration fixture and `check-landing-line.mjs` in CI |
| auto-land-2 | `claude/auto-land-2` | — | 0 ahead | Fully on main already; nothing to bring over |

### Overlap
- The two auto-land builds are one branch: the clash build resolved land.mjs on `auto-land-every-finished-build-lands`
  itself, so s4 is one merge. Main has not touched `push-banner/land/` since that branch last merged main, so the
  land.mjs side should merge cleanly; the builds status files (`_claude/builds/*`, THREADS, tracker.json, plan.json,
  catalog) will clash and take main's copy plus regeneration.
- With this branch: only `framework/spec/BUILDS.md` (auto-land) and `.github/workflows/android.yml` +
  `framework/spec/PORTING.md` (landing-line) overlap, each a one-line addition next to ours: union both.
- Concept overlap: `landing-line@1` (the line's state machine) and this build's `land-run@1` (one attempt's record)
  fit together: the line decides which entry runs and its state; each attempt on the in-flight entry writes one
  land-run@1. `classifyCheckRun` and `ciState` both say cancelled ≠ failure; the lander uses landing-line's
  transitions and records land-run@1 attempts.
- What goes: merge-queue@1 stacking and batching (`merge-queue.mjs` stacks, `queue/pr-*` refs) behind the serial path.
  The auto-land sweeper currently hands green builds to the merge queue "as one batch"; that hand-off is replaced by
  the serial lander.
