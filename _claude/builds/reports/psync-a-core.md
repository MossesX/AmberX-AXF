# psync-a-core-2: pipeline sync, part A (store contract + pipeline)

Hand build `psync-a-core-2`, branch `claude/psync-a-core-2`. Part A of 4 of orchestrator build
`pipeline-sync-live-badges` (its steps s1 and s2, plus the notes on numbers, clashes and the draft PR).
Not opened as a PR and not landed: the voice session combines the four branches.

## What was built

**pipeline-status@1** (`framework/core/pipeline-status.mjs`, schema `framework/schemas/pipeline-status.json`,
fixture `framework/spec/fixtures/pipeline-status.json`, checker `framework/spec/check-pipeline-status.mjs`)

- `PIPELINE_STATES` in order, each with label, tone, icon and a plain status line (`PIPELINE_STATE_INFO`).
- `pipelineView(build, allBuilds)` → `{ state, label, tone, icon, line, attempt, waitingOn, mergeLine, split }`
  (+ `clash` when the build has one). Never throws; a status outside the contract is shown as itself.
  - `waitingOn { buildId, number, title, reason }`: a build at split (or ready) names the build that holds the active place.
  - `mergeLine { position, waitingFor { buildId, number, title } | null, text }`: worked out from the store (builds in a
    landing run, then build-complete ones, oldest first). A `mergeLine` the lander writes on the build wins.
  - A built build with another ahead of it shows `waiting-to-merge`. The lander's own state is read from
    `landing.state` (kept by `normLanding` now), `landingState`, `landerState` or `mergeState`.
  - `merging-pr`, `pr-pulling-main`, `merging-main` show as `merging`, each with its own line.
- `assignNumbers`, `numberText`: build numbers `B-0123`.

**Builds store** (`framework/cli/builds-store.mjs`)

- Every read (`loadStore`) carries a computed `pipelineView` per build. It is never stored: every write drops it and
  `verify` fails if one is found in the store.
- `number`: given once to every build a write adds or changes. `buildSeq` on the store is the high-water mark.
  `builds-store.mjs numbers [--apply]` numbers every build without one (dry run: 1097 builds, B-0001 … B-1097).
- `builds-store.mjs view <build>`: the read every screen gets (number, pr, split, pipelineView, step uid / splitBy /
  model / modelBy / status).
- Stored as they are: `pr` (the PR number, as before), `prUrl`, `prDraft`, `split`, `clash`; on a step `uid`,
  `splitBy`, `modelBy`, `waitsFor`.

**Pipeline** (`apps/console-web/plugins/build-orchestrator/pipeline2.mjs`)

- Split provenance: `split { by: 'vps', model, at, stepCount, host }` on the build, `splitBy` (`vps-fable` |
  `vps-rules`) on each step, `modelBy: 'triage'` once assigning-models is done.
- The refused write after each split is fixed: one splitter per build (see below).
- Update command: after every store change this file makes, one `POST /api/builds/updated { build, state, rev, at }`
  (plus `step` on a step change), inside the console container with its token, detached, 3 s timeout. A console that is
  down costs nothing.
- Draft PR the moment a build starts (active place taken, emergency lane entered, a hand build first seen building):
  branch `lander/<build>` (the lander's own branch) as one empty `[skip ci]` commit on main, a draft PR, and `pr`,
  `prUrl`, `prDraft`, `branch` in the store. Once the build is built the PR is taken out of draft (GitHub refuses to
  merge a draft).
- Steps never share files: steps tied by a file, directly or through a third, become one session
  (`build-clash.mjs disjointParts` / `separateParts`).
- Intake clash check (`framework/core/build-clash.mjs`, new): at the split, and again when a build is about to start,
  it is checked against every build not on main yet (pulling-main through merging-main). On a clash the whole build is
  rejected (`clash { rejected, reason, with, options }`, a note, badge "Rejected (clash)") and does not hold up the
  builds behind it. Answers: `pipeline2.mjs act <build> run-all` or `defer`. Deferred steps carry `waitsFor` and start
  by themselves when that build lands; a build whose every step is deferred waits at split without taking the place.

## Who split pipeline-watch-test, and the refused write

The split is Fable on the VPS: the dispatcher log on the host has `design` by `fable` for it, from
`pipeline2.mjs designSteps` (model policy key `fable`). No fix needed there.

The "refused a write by orchestrator … step replaced" note came from two passes splitting the same build at once.
Both found it at `pending` while Fable was still answering, both asked Fable, and the second answer was written over
the first a few seconds later. The log shows it on both builds: pipeline-watch-test split at 23:22:38 and refused at
23:22:43; pipeline-sync-live-badges split at 23:59:57 and refused at 00:00:21. Now the pass that moves a build to
`splitting` writes a claim in the same store write, other passes stand back, and a late answer is dropped. A test runs
two real processes against a slow splitter: one split, Fable asked once, nothing refused. The same finding is a note
on build `pipeline-sync-live-badges`.

## Checks run

| Check | Result |
| --- | --- |
| `node framework/spec/check-pipeline-status.mjs` | 262 passed |
| `node framework/spec/check-pipeline-2.mjs` | 96/96 |
| `node apps/console-web/plugins/build-orchestrator/test/p2-sync.test.mjs` (new) | 71/71 |
| every other `build-orchestrator/test/*.test.mjs` and `pipeline.test.mjs` | all pass |
| `deploy/lander/test/*.test.mjs`, `plan-studio-2/live.test.mjs` | all pass |
| `check-builds-store-data`, `-lock`, `check-builds-live`, `check-landing-line`, `check-build-steps`, `check-build-watchdog`, `check-json-data-writes` | all pass |
| `node framework/cli/builds-store.mjs verify` (live store, read only) | ok, 1097 records |
| `check-builds-store.mjs` | not completed on this host: it hangs at the journal read over axf-data. Same hang on the untouched base commit. |
| `check-build-hook.mjs` | runs out of memory on this host, on the untouched base commit too; 26 passed with the hub data store off |

## For the session that combines the four branches

- CI runs checks by name. Add to `.github/workflows/android.yml` (not my file):
  `node framework/spec/check-pipeline-status.mjs` and
  `node apps/console-web/plugins/build-orchestrator/test/p2-sync.test.mjs`.
- `framework/catalog/status.json` + `tracker.mjs` not touched (shared file): add the feature line once, for all four parts.
- `framework/spec/PORTING.md` has the deferred Kotlin twin (one section, next to the pipeline-2 one).
- After the merge, on the host: `node framework/cli/builds-store.mjs numbers --apply` numbers the 1097 existing
  builds in one write (oldest first). Until then only new and changed builds get a number.
- The two clash answers work from the CLI (`pipeline2.mjs act <build> run-all|defer`) but not yet from the screens: the
  server whitelists need them. Add `"run-all", "defer"` to `P2_ACTIONS` in
  `apps/console-web/plugins/build-orchestrator/server/__init__.py` and to `ORCH_ACTIONS` in
  `apps/console-web/plugins/plan-studio-2/server/__init__.py` (neither is my file).

## Known gaps

- The GitHub write path of the draft PR (start commit pushed, PR created, taken out of draft through GraphQL) was not
  run against GitHub here: only its read path was (remote, token, a PR read), plus a command-driven fake in the test.
  The first real build after the merge is its first live run. `AXF_P2_DRAFT_PR=off` turns it off.
- A build cancelled or a hand build that ends with nothing to land leaves its draft PR and `lander/<build>` branch
  open: nothing closes them yet.
- The clash check follows Brett's rule to the letter: a new build that touches files of the build that is active now
  is rejected too, although it would have waited its turn anyway. `defer` then makes it start when that build lands.
- A step that names no files cannot be judged: hand builds have one step with no files, so nothing clashes with them
  unless the step lists files.
- A build with only deferred steps left sits at `building` with nothing running until the other build lands; the
  watchdog was not taught about that state.
- Two writers that add builds at the same instant in cutover mode can give both the same number; the next write
  gives the newer build a new one.
- Steps s1 and s2 of `pipeline-sync-live-badges` were not ticked: that build must not be started, and its steps are
  Pipeline 2.0 status rows the lander owns.
