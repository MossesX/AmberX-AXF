# p2-integrate: Pipeline 2.0, the four parts in one PR

Branch `claude/p2-integrate`, PR #852, Nov 19 2026, Opus. The PR is open and not merged; the merge queue lands it.

## What it is

From `origin/main` (`14abab08a`), these four branches were merged in order, with one commit per merge:

- `claude/p2-status-core`: the pipeline-2@1 contract, forward-only store, Plan Studio send, orchestrator flow, accounts
- `claude/p2-lander`: the one-PR lander, size cap, merge-queue@2 view, push banner uninstalled
- `claude/p2-watchdog`: the three-layer watchdog, 2.0 crons, store audits moved into the watchdog
- `claude/p2-ui`: one status-driven builds table, store.json projection dropped

The four reports in this folder say what each part does. This file covers the merge and the places where the
parts did not connect.

## Merge conflicts (both sides kept)

| File | Resolution |
|---|---|
| `deploy/install-console.sh` | Watchdog's `cron.mjs install` + `audits.mjs handoff` + retired-cron removal, then the lander's `axf_lander_install`. Watchdog's side still called the retired `axf_auto_lander_install`; that line is dropped (the lander replaces it). |
| `framework/cli/builds-store.mjs` | Status-core's `setFlowStatus` / flow refusals kept; ui's removal of `projectConsole` kept (the one call left in the merged code went). |
| `framework/spec/PORTING.md` | Both deferred-gap entries kept (pipeline-2@1 and status-table@1). |
| `push-banner/web/index.tsx` | Deleted (the lander uninstalled push-banner). UI's change there was the Merge queue panel rendering `builds.merge-queue`; see fix 9. |

## The two named plugs

1. **Tick.** `orchestrator.mjs tick [--build <id>]` now exists.
   - `tick` runs the full dispatcher round, `pipeline.mjs tick()`. That round calls `pipeline2.mjs advance()`, so it
     replaces the retired `axf-pipeline` cron one for one and builds@1 builds keep moving. It then writes
     `<pipeline dir>/orchestrator-tick.json` `{ at }`, which is the heartbeat layer 3 reads.
   - `tick --build <id>` runs `advance({ build })` for that build only. Only that build is split. It is activated only
     when it is next in line, and the active-build work runs only when it is the active build. The one-active-build
     rule is unchanged.
   - Both forms re-exec under the dispatcher's lock (`pipelineLock()`, the same lock step exits and `advance` take).
   - Layer 3's `tickScript` probe now finds the command, so the tick check is live.
   - Tested end to end through the CLI in `test/p2-flow.test.mjs`: heartbeat fresh, `L3.facts().tickScript === true`,
     and no `tick` problem.
2. **Retries / pinned account.** New `pinnedAccount(accounts, step)` in `framework/core/pipeline-status.mjs`. A step
   at `ready` with `account` set goes to that account if it passes the same test as `pickAccount`: not marked out,
   usable, has usage left, has a free slot, and takes Fable when needed. Otherwise `pickAccount` chooses as before,
   never an out account.
   - `pipeline2.mjs dispatch` tries the pin first and logs `pinned-account` / `pin-skipped`.
   - The step's `tried` list is added to the normal picker's avoid set.
   - Tested: the pinned account is launched straight away, and the picker's own first choice is never tried. An out
     pin falls back to another account.

## Every other place the parts did not connect

| # | What one part expected | What the other provided | Fix |
|---|---|---|---|
| 3 | Watchdog relaunches a failed step at **`ready`** | Contract refused `failed (from building) → ready` (earlier than `failedFrom`), so the store would refuse every relaunch | Contract re-entry `RELAUNCH_FROM`: a step failed at ready/sending/building may re-enter at `ready`. Nothing else may move backwards (`failed from completed → ready` is still refused). Fixture regenerated, spec rule 2 + 7. |
| 4 | Watchdog read/wrote `failedAt`, `history`, step `session` | Status-core's names are `failedFrom`, `statusLog`, `tmux`; the store dropped the others. Worse, step `session` is the builds@1 `same`/`new` field, so the watchdog probed tmux session `same`, found it dead, and would have failed every building step | Watchdog switched to `failedFrom`, `statusLog`, `tmux` (`core.mjs`, `layer2.mjs placeOf`, tests, README) |
| 5 | Watchdog keeps `tried` on steps, notes carry `by` | `normStep` / `normBuild` dropped both | `normFields` keeps step `tried` (unique, last 10); `normBuild` keeps note `by` when set |
| 6 | Lander writes `landing`, `landedAt` and its own `failure` record | `normBuild` dropped `landing` / `landedAt`. `failure` went through done-means-merged's `normFailure`, which rejects the lander's kinds, so every lander failure record was lost | `normLanding` / `normLandFailure` (pipeline-status.mjs). A Pipeline 2.0 build keeps the lander's failure shape; builds@1 builds keep done-means-merged's |
| 7 | Lander's next PR group restarts at `merging-pr`; its retries re-enter at re-run CI / split / pull main | Forward-only refused `merging-main → merging-pr` and `failed (from merging-main) → pr-pulling-main`, so size-capped and split builds could never land | Contract re-entry `LANDING_GROUP`: inside a landing run a build may start the next group at `merging-pr`, and a failure in the run may retry at any status of it. Other backward moves are still refused |
| 8 | Status-core: `landed` needs done-means-merged evidence | The lander wrote only `status: landed`, so the guard would refuse every landing | Lander records `landing.lastMerge {pr, sha, head, at}` at the merge (merge commit sha from GitHub) and writes `mergedAt` + `landed {pr, sha, mergedAt, ci: success}` with `landed` (`landedEvidence`). Landed with no evidence is still refused, loudly |
| 9 | One Merge queue view | Lander's `merge-queue-view` and ui's orchestrator both registered view `merge-queue` and a nav item; ui's slot host (push banner) was uninstalled | `merge-queue-view` (owns `view:merge-queue`) renders the orchestrator's `builds.merge-queue` table when it is filled, under its page header, and falls back to its own grid without the orchestrator. Orchestrator's duplicate view, nav item and `MergeQueueView` removed. Its optional capability is now `merge-queue@2` |
| 10 | One active build includes a build failed while active | Lander failures carried no `failedFrom` (it stamps `statusAt` itself, so the store never stamped it), so a failed landing build lost the active place and the next build could start pulling main | Lander's `applyChange` records `failedFrom` on `failed` and drops it on the way out |
| 11 | Lander clears `failure` / `landing` parts | `makeStore` did `Object.assign(build, next)`, so cleared keys stayed | Writes the whole record |
| 12 | Watchdog retries any failed build, and after two nudges fails a stuck one | The lander owns its statuses, retries with its own backoff and never gives up. Both writing would race, and a watchdog `failed` without a lander failure record would strand the build | Watchdog `LANDER_OWNED` (build-complete … merging-main): failed ones are left to the lander. A stuck one is nudged with `deploy/lander/run.mjs tick --only <id>` every `nudgeEveryMin`, never failed |
| 13 | Lander statusLog lines carried `note` | Contract log line key is `why` (`normLogLine` dropped `note`) | Lander writes `why`; `run.mjs show` reads either |
| 14 | UI keeps its own copy of the status lists (status-table-core.mjs) | Canonical module now exists | Lists are identical. `status-table.test.mjs` now asserts they equal `pipeline-status.mjs` (BUILD/STEP statuses, merge queue = `LANDING_GROUP`). An import in the web bundle needs the `@console/axf` copy synced, so that is left |

`deploy/watchdog/contract.test.mjs` (new, in the CI glob) runs the lander's and the watchdog's real write paths
through the store's own guards: `normalizeStore`, `enforceDoneGuard` and `enforceFlow`, as `withStore` runs them.

## Flags left as they were (named, not fixed: outside "no new features")

- `merge-queue@1` readers now get nothing and degrade quietly:
  - watchdog table `tables/merge-queue.mjs` says `available: false`
  - `pipeline.mjs` reads land.json
  - orchestrator `server/__init__.py`
  - the gate's legacy Merge line sub-tab and `lander.*` mode switch
  The lander report already lists them for a follow-up.
- builds-live still publishes `_claude/builds/store.json` to main (p2-ui). Removing it needs one decision: stop the
  publish, untrack the file, drop the tracking path.
- Layer 3 does not watch the lander's own timer. The lander has its heartbeat and systems-check item.
- `_claude/memory/docs/auto-lander.md` still describes auto-lander@1.

## For Fable review (contract changes made here)

These were made on Opus: headless, nobody to ask, and the parts could not land without them.

- `framework/core/pipeline-status.mjs`:
  - `RELAUNCH_FROM`, `LANDING_GROUP` and the two re-entries in `checkTransition`
  - `pinnedAccount`
  - step `tried`
  - `normLanding` (with `lastMerge`) and `normLandFailure`
- `framework/plan/builds-store-core.mjs`: a P2 build's `failure` uses the lander's shape; `landing`, `landedAt` and
  note `by` are kept.
- `framework/schemas/json/pipeline-2.schema.json`: `landing`, `landedAt`, step `tried`.
- `framework/spec/fixtures/pipeline-2.json`: regenerated with 6 new transition cases.
- `framework/spec/PIPELINE-2.md`: rules 2 and 7, the lander's fields, the tick.
- The Kotlin twin stays deferred (PORTING.md entry unchanged: no Android surface writes statuses).

## Checks

Node v20.20.2 on this VPS. The script and per-check logs from this run are in `/tmp/p2checks/` (summary.txt).
Everything below passed on the merged branch except the last four rows.

| Check | Result |
|---|---|
| check-pipeline-2 | 41/41 |
| p2-flow (incl. tick CLI, pinned relaunch, layer 3) | 35/35 |
| orchestrator pipeline.test / test.mjs / test.py / launch-retry / toolbar / test-watchdog / status-table | 66 / 35 / 64 / 5 / 32 buttons / 15 / 9 |
| plan-studio-2 | 17 |
| build-pipeline / build-lock / agent-slots-data / agent-slots / build-limit | 154 / 8 / 6 / 56/56 / 52/52 |
| builds-store-data / builds-live / data-store / headless-context / plugin-catalog / plugin-settings / ui-predict | 10 / 69 / 68 / 38 / 55 / ok / 12 |
| lander `node --test deploy/lander/test/` | 21/21 |
| merge-queue-view / gate test / build-rules / toolbar / routes / lander routes | 12 / 21 / 8 / 28 buttons / 34 / 45 |
| framework/deploy test.sh / landing-line / gate-rules / json-data-writes / ref-links / build-breaker | 58 / 32 / 38 / ok / 19 / 14 |
| watchdog `node --test deploy/watchdog/` | 20/20 |
| model-policy / `bash -n install-console.sh` | 18 / ok |
| activity / crew-live / whats-shipped / builds-page / maintenance / agent-voice | 142 / 57 / 47 / 14 / 96 / 41 |
| server projects / readcache / data_store | 12 / 14 / ok |
| check-theme / controls / toolbars / chrome-assets | ok |
| plugin-lifecycle gate / merge-queue-view / push-banner --after-uninstall | clean |
| console-web `npm run build` (heavy slot) | ok |
| plugin-lifecycle build-orchestrator | one hit: `.brief.md`, this session's git-excluded brief file. Environment |
| check-build-hook | JS heap out of memory even at 4096 MB. Environment; p2-ui saw the same on main |
| check-builds-store | "history reads the journal home": `spawnSync ENOBUFS` on the 14 MB live journal. Environment; both p2-status-core and p2-ui saw it |
| deploy/claude-workers.test.mjs | 97 pass, 1 fail ("one build account … the run ends"). It fails the same way on `origin/main` and on `claude/p2-status-core` alone, so it is not from this merge. VPS load was 7 at the time |

## UI Review

The one UI change made here is the single Merge queue view. Its desktop and phone shots
(`/root/axf-builds/_shots/p2-integrate/`) were submitted as `r-20261119-zbhzh01`, group
"p2-integrate - Nov 19 1:55 PM". It went to the worktree store, because this run has no `AXF_CONSOLE_URL` / `AXF_TOKEN`;
p2-ui and p2-lander hit the same limit. A systems check item (`p2-integrate:ui-review`, posted through the console's
alerts API the way the dispatcher posts its own) gives the exact `--console` commands to file them, so Brett sees
them. The PR says it is waiting in UI Review.

## Build record

PR [#852](https://github.com/MossesX/AmberX-AXF/pull/852), "Pipeline 2.0", is open and not merged.

There is no build record for `p2-integrate` in the store, the same as for the four parts, so there were no steps to tick.
`builds-live.mjs link p2-integrate --branch claude/p2-integrate --pr 852` answered `No build "p2-integrate"`.
