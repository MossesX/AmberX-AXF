# BUILD-PARALLEL — fill every slot: parallel steps, claims and the merge back (build-pipeline@1)

Status: contract since Nov 13 2026 (build `always-fill-every-slot-when-slots-are-free-run-independent-steps-of-running-bu`, Fable).
Brett: "Always fill every slot: when slots are free, run independent steps of running builds in parallel across them, and
auto-queue pending builds."
Reference implementation: `framework/core/build-pipeline.mjs` (pure, IO-free): `normAfter`, `normClaim`, `claimLive`,
`dependsOn`, `stepBranch`, `readySteps`, `expiredClaims`, `claimStep`, `releaseStep`, `pickAccount`, `planFill`.
Store side: `framework/plan/builds-store-core.mjs` (`normStep`, `validateStore`, `dependencyCycles`), IO
`framework/cli/builds-store.mjs`. Schema snapshot: `framework/schemas/builds.json`.
Checks: `node framework/spec/check-build-pipeline-fill.mjs` replays `fixtures/build-pipeline-fill.json` (`--write`
regenerates the expected outputs); `node framework/spec/check-builds-store.mjs` covers the store side.
No Kotlin or Python twin: the planner runs only in the VPS dispatcher (see PORTING.md, deferred).

## 1. Step dependencies (`after`)

A builds@1 step may carry `after: [stepId]`, the steps of the same build that must be settled (done or skipped) before it
may start.

| `after` | Meaning |
|---|---|
| absent | **implicitly sequential**: the step waits for the step before it in the list. Every build from before this contract, and every step a splitter does not mark, runs exactly as it always did. |
| `[]` | **independent**: it may start as soon as the build is running. |
| `['s1', 's3']` | waits for those steps. Ids name steps of the same build. |

Rules (`normAfter`, `validateStore`):
- a step never names itself; duplicates are dropped; at most 20 ids;
- an id that names no step of the build is an error the store check reports (`"zz" is not a step of this build`);
- the **resolved graph** (`dependsOn`: explicit lists plus the implicit previous-step edge) must be acyclic. `s1.after =
  [s3]` with a plain `s3` after a plain `s2` is a cycle (`s1 → s3 → s2 → s1`) and is refused;
- a skipped step counts as done for the steps after it;
- the migration is a no-op: nothing adds `after` to an older step. Absent and `[]` are kept distinct through
  normalisation, the orchestrator export and absorb, and the newer-wins merge.
- the migration (`builds-store.mjs migrate-deps [--dry]`, `migrateStepDeps`) leaves every older build without a list
  (one step at a time), moves a stray stored `dependsOn` to `after`, and stamps `meta.versions.stepDeps = { version: 1,
  at, by }` once, in one journal line (`migrate-step-deps`). The dispatcher runs it on its first tick. `verify` names a
  dependency on a missing step and every cycle (`stepDepsReport`) and exits 1.

### 1a. `dependsOn`, `parallel` and `files`

| Field | Values | Rule |
|---|---|---|
| `dependsOn` | `[stepId]`, input only | the same list under the splitter's and the API's name. `normStep` stores it as `after` (`after` wins when both are given); the store check refuses a stored `dependsOn`. `explicitAfter(step)` reads either. |
| `parallel` | `auto` (default, not stored) / `never` | `never`: only the build's own session runs the step, even when every dependency is done (rebases, merges, releases, shared state). The planner skips it; `isParallelStep` is false. An unknown value is dropped on normalisation and named by the store check. |
| `files` | `[path]` (existing field) | two steps that share a file never run at once. `fileClashes(build, step, { now, against })` lists the live-claimed steps (or the `against` steps) sharing a file with it; `readySteps` leaves such a step out; `claimStep` refuses it (`s3 files clash with s2 (path)`); the planner holds it back with the same reason and never launches two clashing steps in one round. A step with no files never clashes. |

A step is a **parallel candidate** when it has an explicit list (`after` / `dependsOn`) and is not `parallel: never`.
Steps with no list run in order, as before.

## 2. Claims (`claim`)

`claim: { runId, slot, account, branch, at, model, expiresAt }` is the session working the step right now.

- `runId` = the dispatch / run id; `slot` = the agent-slots entry; `account` = the saved Claude account name;
  `branch` = where the work happens (§4); `at` = when taken; `model` = the step's pinned model the session was
  launched on; `expiresAt` = `at` + TTL.
- **TTL** `CLAIM_TTL_MS` = 45 min (steps are ≤ 10 min; the rest covers session start-up and the merge back). A claim past
  `expiresAt` is dead: `claimLive` is false, the step is ready again, `expiredClaims` lists it for the dispatcher's note.
- **Model-aware**: a claim is never taken on a model above the step's pin (`Opus` step, `Fable` launch → refused: raise
  the step first). A lower model is a downgrade and allowed; the claim records the model that actually runs.
- A done or skipped step carries no claim (`normStep` drops it; ticking a step releases it).
- `claimStep` is refused when the step is missing, settled, not ready, or held by another run's live claim; the same
  `runId` renews its own claim. `releaseStep` with a `runId` releases only that run's claim; without one, any claim.
- Newer wins on merge: a release on the newer copy wins over a claim on the older; a claim on the newer copy survives
  an older copy without one (builds-merge-core).

## 3. Ready steps and the planner

`readySteps(build, { now, model })`: open steps whose dependencies are all settled and that carry no live claim, in
list order. `model` narrows to one pin.

`planFill({ slots, accounts, running, queue, pending, settings })` fills every free slot, in this order:

1. **Ready steps of running builds** that are parallel candidates (§1a: an explicit list, not `parallel: never`). A step
   without a list is sequential and belongs to the build's own session, and so does the first ready step when no step
   of the build is claimed yet (the main session has not started claiming). A candidate that shares a file with the
   session's step or with a step launched this round waits (`files clash with s2 (path)`). Per build at most
   `pipeline.maxParallel` (else `maxParallelPerBuild`, 3) parallel sessions beyond the main one.
2. **Queue builds** by priority (P0 first), then queue time (`queueOrder`); equal priority and queue time fall back to
   creation time. Held builds are skipped and say so; unsplit builds wait for the split.
3. **Pending builds** when `autoQueue` is on, by priority then creation time, only when **split** (steps present) and
   with **no clash**: a Pending build whose open steps touch a file an open step of a running build (or of a build
   launched this round) touches waits (`files clash with running build r1 (path)`). Off: the planner reports how many
   wait for Brett.

Every launch takes one agent slot and one account slot on the launch's pinned model. Limits, each with its reason in
`waits[].why` or `blocked`:

| Limit | Source | Effect |
|---|---|---|
| memory floor | `slots.memory.availGb < floorGb` | nothing launched this round |
| agent cap | `slots.free` | one launch per free slot |
| VPS hard limit | `slots.hard.free` | caps the free count |
| per-account model limit | `account.free`, `account.fable` | Fable only to accounts with Fable; Opus kept off Fable accounts when another fits |
| subscriptions first | `pickAccount` | API accounts only as overflow (`apiOverflow`) or by the build's `pipeline.route = api` |
| API budget cap | `settings.budget { capUsd, spentUsd, perLaunchUsd }` | an API launch past the cap waits |
| per-build parallel cap | `pipeline.maxParallel` (0 = `maxParallelPerBuild`) | a running build never has more parallel sessions than its cap |
| per-build budget | `pipeline.budgetUsd`, `pipeline.spentUsd` | an API launch of that build past its own cap waits (`build budget cap reached`); subscriptions are never counted |
| file clash | step `files` | a step beside one on the same file waits; a Pending build on a running build's file waits |
| round guard | `maxLaunchesPerRound` (12) | never more launches in one round |

Per-build caps live on the pipeline record (`build-pipeline@1`): `maxParallel` (whole number, 0 = default, at most 12),
`budgetUsd` and `spentUsd` (dollars, 0 = none). The dispatcher adds each API run's cost to `spentUsd`; the planner only
reads it.

Launch record: `{ kind: step | build | pending, id, step, model, account, accountKind, rule, branch, why }`.

## 4. Running a parallel step and merging it back

- A parallel step (one with an explicit `after`) runs on branch **`<build-branch>--<stepId>`** (`stepBranch(build, step,
  { parallel: true })`, e.g. `claude/my-build--s3`) in its **own worktree** created off the build branch at launch
  (`/root/axf-builds/<build>--<stepId>`). A sequential step runs on the build branch in the build's own worktree.
- The session commits on its step branch, ticks the step done (the tick releases the claim), and the dispatcher merges
  the step branch into the build branch (`git merge --no-ff` in the build's worktree, then push; never into main).
- **Merge conflict**: the claim is released (`releaseStep` with the note `merge conflict on <step-branch>: sequential
  retry`), the step is marked `done: false`, its `after` is replaced by the previous step's id so it becomes sequential
  and runs again inside the build's own session once the steps before it are done, the step branch is kept for the
  retry to read, and a build note says what conflicted. The conflicting branch is never force-pushed or deleted.
- A merged step branch is deleted and its worktree removed. A claim that expires with the branch unmerged is treated
  like a conflict: release, note, sequential retry.
- The builds files (`_claude/builds/**`) merge through the `axf-builds` driver as before; code conflicts are the only
  kind that trigger the retry.

## 5. API

Everything here is state on the builds@1 record, so it reaches the console API, MCP and CLI through the orchestrator's
existing build routes (`orchestrator.mjs`, `GET /builds/{id}`; a step shows `after` and `claim`). The planner's result is
read-only data (`planFill`) the dispatcher logs on each tick (`pipeline.mjs tick --json` on the VPS); the worktree and
merge commands live in the dispatcher, not here.

## Fixtures

`fixtures/build-pipeline-fill.json`: `ready` (readySteps with implicit and explicit edges, claims live and expired),
`claims` (claimStep / releaseStep accept and refuse cases) and `fill` (planFill scenarios: mixed slots, memory floor,
hard limit, auto-queue off and on, budget cap). Every block is `in` → `out`; a port replays `in` and must answer `out`.

Golden cases for the §1a rules and the planner's caps:

| Case | `ready` | `claims` | `fill` |
|---|---|---|---|
| linear steps unchanged (no `after` anywhere) | `linearUnchanged`, `oldBuildSequential` | | `linearUnchanged` (nothing launched beside the main session) |
| fan-out / fan-in DAG (`after` and `dependsOn`) | `fanOutFanIn`, `fanInDone` | | `fanOutFanIn` (s3 and s4 fill two slots, s4 on the Fable account; s5 waits) |
| file-overlap clash held back | `fileClashHeld` | `fileClashRefused` | `fileClashHeld` (s3 beside the session's s2, s6 beside s5) |
| `parallel: never` | `parallelNever` | | checked as an invariant (never a parallel launch) |
| a Fable step with no Fable account free | `fableOnly` | | `fableNoFableAccount` (the Opus step launches, both Fable items wait) |
| auto-queue off vs on | | | `autoQueueOff`, `autoQueueOn`, `autoQueueClash` (unsplit and clashing Pending builds wait) |
| caps reached | | | `capsReached` (per-build `maxParallel`, the default 3, then the agent cap), `parallelCapAndClaimedMain`, `memoryFloor`, `hardLimit`, `apiOverflowWithinBudget` |
| a priority order tie | | | `priorityTie` (same priority: queue time, then creation time; P2 last) |
