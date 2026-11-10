# Auto-requeue: builds whose session stops early go back to the Queue, not Pending

Build `auto-requeue-builds-whose-session-stops-early-go` · Phase 1 · Opus · branch `claude/auto-requeue-builds-whose-session-stops-early-go`

Brett (2026-11-10 23:36): "Yes, re-queue them and auto-requeue."

## What changed

**Auto-requeue (s1).** When a headless session exits cleanly with steps left, the dispatcher now puts the build straight back in the Queue instead of Pending:
- Its priority and `queuedAt` stay the same, so it keeps its place in the start order. The next run continues from the next open step.
- Pending only happens after **3 early stops in a row with no step done**. The count is the `maxEarlyStops` setting, 1–10.
- A session that stops while the build is `waiting` on an approval also goes to Pending, because relaunching can't get past an approval.
- The `ended` alert (`pipeline:end:<id>`, pushed to AmberX through notify type `pipeline.ended`) and the build note carry the session's own last note as the reason.
- Early stops don't count against `maxRuns`, which still applies only to crashes and limits.
- A run that ticks a step resets the count to 0. So does a finish, a phase switch, a give-up to Pending, and Brett queueing the build again.

**Re-queue the ones already in Pending (s2).** New `requeue-returned` command. It queues every Pending build a session handed back. It matches builds whose `lastRun` is `returned`, and also builds whose record lost its `lastRun` but whose last dispatcher note says "stopped on its own … back in Pending for Brett" with nothing queued or started after it. I ran it once on the live store and it queued 4 builds:
- `molly-banner-match`
- `home-page-build-queue-card-opens-the-orchestrato`
- `resolve-conflicts-and-land-pr-449-account-order`
- `convert-every-app-into-a-molly-module-expenses-c`

**Stall watchdog.** This is the end-of-run half of the stall watchdog: it lives in the dispatcher's `checkEnds()`. The `afterTick` hook the watchdog uses is unchanged.

## Files
- `framework/core/build-pipeline.mjs`: `pipeline.openAtLaunch`, `pipeline.earlyStops`, `MAX_EARLY_STOPS`, `earlyStopsAfter()`. `outcomeOf()` now takes `earlyStops` / `waiting` and a `maxEarlyStops` limit. New note lines.
- `apps/console-web/plugins/build-orchestrator/pipeline-core.mjs`: `endOutcome()` returns `patch.earlyStops`, `early` and `reason`. New `stopReason()`, `returnedByNote()` and the `maxEarlyStops` setting.
- `apps/console-web/plugins/build-orchestrator/pipeline.mjs`: records `openAtLaunch` at launch and writes `earlyStops` at the end of a run. `queue()` resets the count. New `returnedBuilds()`, `requeueReturned()` and the CLI command `requeue-returned`.
- `apps/console-web/plugins/build-orchestrator/server/__init__.py`: `POST /pipeline/requeue-returned`. `maxEarlyStops` is accepted by `POST /pipeline/settings`.
- `apps/console-web/plugins/build-orchestrator/plugin.json`: action `pipeline-requeue-returned` and `maxEarlyStops` in the settings action schema.
- `framework/spec/PORTING.md`: Kotlin twin recorded as a deferred gap.

## API (no UI change in this build)
| What | REST | MCP / console action | CLI | Voice |
|---|---|---|---|---|
| Re-queue builds that stopped early | `POST /pipeline/requeue-returned {dry?}` | `build-orchestrator.pipeline-requeue-returned` | `pipeline.mjs requeue-returned [--dry]` | "re-queue the builds that stopped early" (action description) |
| Early-stop limit | `POST /pipeline/settings {maxEarlyStops}` | `pipeline-settings-set` | `pipeline.mjs set maxEarlyStops=3` | through the settings action |
| State | `GET /pipeline`, `GET /pipeline/tab/queue` (`pipeline.earlyStops`, `pipeline.lastRun`) | `pipeline-status` | `pipeline.mjs show <id> --json` | "what's in the queue" |

## Tests
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 44 checks pass, including end-to-end CLI ticks. Two early stops requeue and relaunch in the same tick with the same `queuedAt`; the third goes to Pending with the reason; `requeue-returned` with `--dry` and for real.
- `node apps/console-web/plugins/build-orchestrator/test.mjs`: 33 pass.
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 34 pass, including the new route and setting.
- `check-theme` and `check-controls` pass.
- `plugin-lifecycle check build-orchestrator` still reports 5 stale references in older framework files (for example `framework/cli/dispatch-gate.mjs`). None are from this build.

## Notes
- The dispatcher on the host runs main's code. Until this PR lands, a requeued build that stops early again still goes to Pending under the old rule.
- `convert-every-app-into-a-molly-module-expenses-c` stopped because its s1 waits on two other builds. If it stops again with no progress, it goes back to Pending after 3 tries.
