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

## Dispatcher: why queued builds left slots empty (s12)

Read from the live store, `pipeline.mjs status`, `agent-slots.mjs status` and `/var/log/axf-pipeline.log` (Nov 8 to
Nov 14). Nothing was launched to do this: `status` is read-only. Right now (Nov 14 23:00) all 8 slots are really in use
(7 build sessions + 1 in setup), so the gaps came earlier. Wait reasons on ticks that launched nothing:

| Reason on idle ticks | Nov 13 | Nov 14 |
|---|---|---|
| launch failed 3 times in the last hour: waiting | 605 | 90 |
| VPS hard build limit reached (8/8 or more) | 340 | 114 |
| mossesx-max- 5/5: every account is at its parallel cap | 137 | 0 |
| no free agent slot (0/8, 1/8, 2/8 in use) | 47 | 0 |

**Cause 1 (the main one): parked and failed launches take a slot in the plan and give it back to nobody.**
`pipeline-core plan()` hands one free slot to each queued build in order. The tick then skips the ones that failed to
launch 3 times in the last hour (`LAUNCH_FAILS_PER_HOUR`). It also loses the slot of any launch that fails this tick.
The slot is already spent in the plan, so the builds behind are told "no free agent slot (0/8 in use)" with every slot
empty. On Nov 13 00:45 the launcher refused every build (`claude-headless: --log is a plain file name`). The failed
builds sat at the top of the Queue, so each tick spent its 8 slots on them: 2 to 6 slots stayed empty for an hour at a
time, while builds that could have run waited behind.

**Cause 2: one usable account with a parallel cap below the slot cap.** On Nov 13 only `mossesx-max-` was usable
(account-3 can't sign in; the two API accounts take builds only when routed). Its cap was 5 against 8 slots, so 3 slots
could never fill. It is 8 now (override), so this no longer limits, but nothing warns when the usable accounts' caps
add up to less than the slots.

**Cause 3 (counting, smaller): the hard limit counts sessions the dispatcher didn't start.** `hard.live` counts every
`axf-*` tmux session plus launches still in setup. On Nov 13 it read 9/8 and 10/8, and agent-job sessions
(`axf-rhonda-ci-fix`, from the console container) hold a soft slot too. These are real sessions, so this is correct,
but it is why the count can exceed 8.

Fix (s13): planning skips parked builds without spending their slot, and a failed launch hands its slot to the next
queued build in the same tick. The tick keeps launching until the slots or the accounts run out.

## Landing log

Each attempt is a land-run@1 in the push banner's data folder (`land-runs.jsonl`) and on the build's land record.
`land-one.mjs runs <build>` shows them.

| When (UTC) | Build | Behind main | Outcome | What happened |
|---|---|---|---|---|
| Nov 14 23:09 | move-amberx-web-app-console-amberx-andr (#596) | 2218 | clash, flagged | Merging main clashes in code: `apps/console-web/server/main.py`, `approvals-banner/plugin.json` (the host resolver couldn't settle main.py). P0 fix build `merge-main-land-move-amberx-web-app` filed and queued, with Brett's words + the files. |
| Nov 14 23:09 | change-to-move-amberx-web-app-console (#586) | 1942 | clash, flagged | Clashes in `server/main.py`, `approvals-banner/plugin.json`, `amberx-droid/.../WatchService.java`. P0 fix build `merge-main-land-change-to-move-amberx` filed and queued. |
| Nov 14 23:12 | console-app-part-2-native-floating-2 (#639) | 612 | red (false), back to waiting | `tracker.mjs --check` failed after the merge. It fails on main too on this VPS: the tracker reads the hub data copy of status.json, which lacked 9 entries main has. Copy fixed (only added keys, backup kept); the lander now ignores a check that fails on main too (`failsOnMain`). Back in the line. |
| Nov 14 23:12 | console-app-part-3-native-bridge-mic (#633) | 612 | clash, flagged | Clash in `framework/ui/axf.css`. P0 fix build `merge-main-land-console-app-part-3` filed and queued. |
| Nov 14 23:13 | console-app-part-4-console-side-safe (#640) | 612 | clash, flagged | Clash in `framework/ui/axf.css`. P0 fix build `merge-main-land-console-app-part-4` filed and queued. |
| Nov 14 | console app part 1 | | none | There is no part 1 build in the store (parts 2 to 4 only). The land-parts-1-4 build (`console-app-land-parts-1-4-build-apk`) is queued. |
| Nov 14 | console-app-wake-word-voice-listener (#643) | | not landed | Still queued with open steps (not finished), so it doesn't land yet. Its branch is shared with `console-app-land-parts-1-4-build-apk`. |
| Nov 14 23:13-23:16 | finish hook, serial lander (this branch's code) | | | My land-one runs wrote through builds-live, which fired the finish hook from this worktree, so the serial lander started by itself for builds that finished: one-source-truth-console-shows-only-what and server-gate-one-session-per-build-no clash in `build-orchestrator/pipeline.mjs` (P0 fix builds `merge-main-land-one-source-truth-console`, `merge-main-land-server-gate-one-session` filed). owner-recognized-everywhere-veto, orchestrator-table-columns-model-queue-assigned and pass-approval-hook-deep-link-amberx-notification were the same false tracker red: put back to waiting. A red check was also paused as "merge failed" in the line; fixed (`applyRun`: red check → fix-filed). |

Found while landing: the deployed console has no `POST /land/fix` yet (it ships with the auto-land branch merged here),
so the lander couldn't file the fix builds itself. I filed them with `pipeline.mjs request`. Once this PR deploys, the
lander files them through axf.build-dispatch@1. The VPS also has no GitHub App set up (`github-token.mjs status`:
app not set up), so the lander uses the broker's old token until it is.
