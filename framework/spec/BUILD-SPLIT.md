# BUILD-SPLIT — one build at a time, split to fill every slot (split-plan@1)

Status: contract since Nov 18 2026 (build `one-build-time-always-split-to-fill`, Fable).
Reference implementation: `framework/core/build-split.mjs` (pure, IO-free). Schema: `framework/schemas/split-plan.json`.
Golden fixtures: `framework/spec/fixtures/build-split.json`; check: `node framework/spec/check-build-split.mjs` (CI).
Record home: the `splitId` and `split` fields of a builds@1 record (`framework/spec/BUILDS.md`) and the `mainLock`
record in the store's `meta`. No Kotlin twin: build tooling, nothing an Android app renders (`framework/spec/PORTING.md`).

## Why

Up to now the dispatcher started one queued build per free agent slot, so four unrelated builds ran side by side, each
on its own branch off a different main, and they clashed when they landed. Brett (Nov 18 2026): one build runs at a
time, and that one build is **split** across every free slot, so the slots stay full and nothing lands on a moved main.

Rules, in one place:

1. **One run at a time.** While a run is active (status `splitting`, `running`, `waiting` or `fixing` with a session) no
   other build is launched. The dispatcher's spare slots go to the active run's parts.
2. **Always split to fill.** When a build's turn comes the dispatcher plans as many parts as there are free slots (never
   more than the build's independent file groups, never fewer than one), and every part starts at once.
3. **Split-id gate.** No session is launched for a run without a `splitId`. The id names the plan the session belongs to;
   a brief, a worktree, a slot entry or a status write that carries another split id is refused.
4. **No two parts share a file.** Every step claims files; steps whose claims overlap go in the same part. A plan with a
   file in two parts is invalid and is never dispatched.
5. **One main.** Main is locked for the run (`main-lock@1`). Every part branches off the same `base` sha; the combine
   branch merges the parts onto that sha; nothing else lands on main until the run is `merged` or `failed`.
6. **All or nothing.** The run combines only when every part is `done`. One part failing for good fails the run; a part
   that fails once is rebuilt (up to `maxRebuilds`) while the others keep going.

## Ids

| Thing | Format | Example |
|---|---|---|
| split id | `<build id>.r<n>` — the build's id (build-id@1, ≤ 40 chars) and the run number, 1-based, counted up on every re-split of the same build | `one-build-time.r2` |
| part id | `p<k>`, k 1-based in step order, ≤ 64 | `p3` |
| part ref | `<split id>/<part id>` — how a part is addressed everywhere (API, console control `row:<build>/part:p3`, logs) | `one-build-time.r2/p3` |
| part branch | `claude/<build id>--r<n>-p<k>` (a sibling of the build branch `claude/<build id>`, never under it: git refs cannot nest) | `claude/one-build-time--r2-p3` |
| combine branch | the build branch itself, `claude/<build id>` | `claude/one-build-time` |
| part session | `axf-<build id>--r<n>-p<k>[--<agent>]` (build-lock@1 reads it as the build's session) | `axf-one-build-time--r2-p3--earl` |
| base | the main sha every part and the combine branch start from, 40 hex | |

Regexes: `SPLIT_ID_RE = /^([a-z0-9][a-z0-9-]{0,39})\.r([1-9][0-9]{0,3})$/`, `PART_ID_RE = /^p([1-9][0-9]?)$/`,
`SHA_RE = /^[0-9a-f]{40}$/`. `splitIdOf(buildId, run)`, `parseSplitId(id)`, `partRef(splitId, partId)`,
`partBranch(splitId, partId)` in `build-split.mjs` are the only places the formats live.

## The record on a build

```
build.splitId   '' | '<build id>.r<n>'        the active (or last) run's id; the gate compares against this
build.split     null | {
  $axf:   'split-plan@1',
  id:     <split id>,                            same as build.splitId
  run:    RunState,                              the overall run (below)
  base:   <sha> | '',                            the main sha every part starts from ('' until main is locked)
  at:     ISO,  by: string,                      who made the plan (dispatcher | console | cli | mcp | voice | hand)
  slots:  { free: n, used: n },                  what the planner saw: parts ≤ free
  parts:  [Part…],                               one per part, in part-id order
  combine: {                                     the join of every part (all-or-nothing)
    branch: <build branch>, head: <sha> | '', pr: n | 0, ci: '' | running | success | failure,
    ciRun: string, startedAt: ISO | '', mergedAt: ISO | '', liveAt: ISO | '', finishedAt: ISO | '',
    attempts: n, note: string },
  maxRebuilds: n,                                how often one part may be rebuilt before the run fails (default 2)
  failure: null | { at, part: <part id> | '', why },   why the run failed (run === 'failed')
  history: [{ at, from, to, part?, why }…]       every run and part transition, oldest first, at most 200 kept
}
```

**Part**

```
{ id: 'p<k>', status: PartStatus,
  steps: [step id…],          every open step of the build is in exactly one part, in the build's step order
  files: [path or glob…],     the union of its steps' claims; disjoint from every other part's
  branch: <part branch>, base: <sha>,
  slot: '' | agent-slots entry id, account: '' | account name, session: '' | tmux session, model: '' | Fable | Opus,
  head: '' | <sha>,           the part branch tip once pushed
  startedAt: ISO | '', endedAt: ISO | '',
  rebuilds: n,                how often it has been rebuilt
  lastError: string,          the newest failure's one line ('' when none)
  note: string }
```

Steps on the build keep `done` / `doneAt` as now: a part ticks its steps on the build record, so the row's progress bar
and `openSteps()` need no new reading. Claims come from `step.files` plus the planner's `fileClaims` (the splitter's
predictions per step id). A step with no claim at all joins the part of the nearest earlier step (it keeps its
checkpoint order; nothing is assumed independent without evidence).

## Part status (PartStatus)

`waiting → building → testing → done`, with `failed` and `rebuilding` on the side.

| From | To | When |
|---|---|---|
| waiting | building | its session launched on a slot |
| building | testing | every step of the part ticked; its checks run |
| building | waiting | the session died before its first tick (crash, usage limit): requeued on the next free slot |
| testing | done | checks green, branch pushed with `head` |
| building, testing | failed | a crash past the retry, red checks, a push that never landed |
| failed | rebuilding | `rebuilds < maxRebuilds`: the part's steps are reset and it is rebuilt from the same `base` |
| rebuilding | building | the rebuild's session launched (`rebuilds + 1`) |
| waiting | failed | the run failed before the part started (another part failed for good): it never runs |
| done | rebuilding | its branch would not merge at combine (conflict): rebuilt on the same base while `rebuilds < maxRebuilds`, the run back to `building`; no rebuild left = the run fails |

A `failed` part with `rebuilds ≥ maxRebuilds` is terminal; `done` only moves for a combine conflict. `PART_TRANSITIONS` in the engine is the table;
`canPart(from, to)` answers it; `partNext(part, event, plan)` applies an event (`launch`, `ticked`, `green`, `fail`,
`crash`, `rebuild`, `abandon`, `conflict`) and refuses an unknown step or any move on a `failed` / `finished` run.

## Run state (RunState)

`splitting → queued → building → combining → ci → merging → merged → live → finished`, `failed` from anywhere but the
last three.

| State | Meaning | Row badge |
|---|---|---|
| splitting | its turn came; the planner makes the parts (main locked, base taken) | Splitting |
| queued | parts planned, none launched yet (every part `waiting`) | Queued |
| building | at least one part is building, testing or rebuilding | Building k/n |
| combining | every part `done`; the parts are merged onto `base` on the combine branch | Combining |
| ci | the combine branch is pushed, the PR open, CI running | CI |
| merging | CI green on the combine branch; the auto-lander merges | Merging |
| merged | merged to main (done-means-merged@1 `landed` evidence) | Merged |
| live | deployed where the build deploys (console nightly, hub) | Live |
| finished | the feature verify passed (`complete`) | Finished |
| failed | a part failed for good, the combine could not be made, CI stayed red past the ladder | Failed |

`RUN_TRANSITIONS` is the table; `canRun(from, to)`; `rollUp(parts)` gives the state the parts imply (`splitting` with no
parts, `queued` all waiting, `failed` on a terminal failure, `combining` all done, else `building`) and is what the
expandable queue row shows for the parts phase; past `combining` the run state is set by the combine, CI and landing
events and `rollUp` is not consulted. `combineReady(plan)` is true only when every part is `done`, has a `head` and the
same `base`. `onPartFailed(plan, partId, why, at)` returns the plan after a failure: the part goes `rebuilding` while it
has rebuilds left, else the part is terminal `failed`, every waiting part is `failed` too and the run is `failed` with
`failure` set.

How the run state maps onto the build's builds@1 status: `splitting` → `splitting`; `queued` and `building` →
`running`; `combining`, `ci`, `merging` → `landing`; `merged` → `landed`; `live` → `landed`; `finished` → `complete`;
`failed` → `fixing` (the retry ladder of done-means-merged@1 takes it: a fresh split is a new run `r<n+1>`, never a
status jump). `buildStatusOf(runState)` in the engine.

## Main lock (main-lock@1)

```
store.meta.mainLock = null | { $axf: 'main-lock@1', build: <build id>, splitId, base: <sha>, lockedAt: ISO, by, note }
```

Taken when a run enters `splitting` (the dispatcher reads main's head and writes it as `base`), released when the run is
`merged` or `failed`. While it is held: no other build is launched; the auto-lander lands only this run's combine PR;
any part whose `base` differs from the lock's is refused (`validatePlan`). The holder keeps main while its builds@1
status is one of `HOLDS_MAIN` (`splitting running waiting fixing queued landing`: active, retrying, between phases,
landing); any other status (`pending`, `landed`, `complete`, `failed`, `escalated`, `archived`, deleted) means the run
ended and the lock is released on the next tick. A lock older than `MAIN_LOCK_STALE_MS` (6 h) whose holder has no
active run (a stalled landing, a lost run) is stale: the dispatcher releases it and notes the run. `lockMain(meta, …)`,
`unlockMain(meta, …)`, `mainLocked(meta, { now, builds })` in the engine; `pipeline.mjs main-lock [release [--force]]`
on the CLI (a held lock is only released with `--force`).

## Planner (`planParts(build, freeSlots, fileClaims, opts)`)

1. Open steps (`!done && !skip`) in order; a build with none has nothing to plan (`parts: []`, why).
2. Claims per step = `step.files` ∪ `fileClaims[step.id]`, normalised (trimmed, `./` dropped, no empty, ≤ 300 chars).
3. Steps are grouped: two steps sharing a claim share a group (union-find); a step with no claim joins the previous
   step's group (the first such step opens its own).
4. Groups are packed into `min(freeSlots, groups)` parts: heaviest group first (sum of step estimates in minutes,
   10 when a step has none) onto the lightest part; ties by first step index. Parts are then numbered `p1..pn` by their
   first step's index, each part's steps in build order.
5. Every part gets the branch, `base`, `status: 'waiting'`, `rebuilds: 0`; the plan gets the split id (`run` = the
   build's previous run + 1), `run: 'queued'`, `slots: { free, used }`.

`validatePlan(plan, build)` → `{ ok, errors[] }`: schema shape, split id matches the build, part ids `p1..pn` in order,
no file in two parts, every open step in exactly one part and no done step in any, one `base` on every part equal to
the plan's, branches match the format, `parts.length ≤ slots.free` when slots are recorded. The dispatcher never
launches a plan that fails it.

## API

Everything the queue row shows is reachable without the UI (Brett, Nov 8 2026: everything comes with an API). Phase 1
ships the contract and engine; the addresses are fixed here so phase 2 wires the same four surfaces to them:

| Action | REST (`/api/plugins/build-orchestrator/…`) | MCP | CLI | Voice |
|---|---|---|---|---|
| read a run | `GET builds/<id>/split` | `orchestrator_split_get` | `orchestrator.mjs split <id>` | "show the split of <build>" |
| plan / re-plan | `POST builds/<id>/split {slots?}` | `orchestrator_split_plan` | `orchestrator.mjs act split <id> [--slots n]` | "split <build>" |
| part state | `GET builds/<id>/split/parts/<p>` | `orchestrator_split_part` | `… split <id> <p>` | |
| rebuild a part | `POST builds/<id>/split/parts/<p>/rebuild` | `orchestrator_split_rebuild` | `… act rebuild <id> <p>` | "rebuild part 3 of <build>" |
| fail / abort a run | `POST builds/<id>/split/fail {why}` (confirm) | `orchestrator_split_fail` | `… act split-fail <id> --why` | |
| main lock | `GET pipeline/main-lock`, `DELETE …` (confirm) | `orchestrator_main_lock` | `pipeline.mjs main-lock [release]` | "is main locked" |
| deep link | console control `row:<build>/split`, `row:<build>/part:<p>` (expands the row) | `console_control_show` | `axf console show row:<build>/split` | "open the split of <build>" |

## Migration

- Existing builds get no `split` and `splitId: ''`: `normBuild` leaves both out of the record until a run is planned, so
  no record changes on the first read and nothing is lost. Unknown fields a newer writer adds are carried over verbatim
  (`extra`), never dropped by an older reader.
- The "up to 4 builds at once" rule (agent slots filled with distinct builds) is retired: the slot count stays, the
  dispatcher launches ONE build per tick and only while no run is active and main is free (`plan()` in
  `pipeline-core.mjs`: every other queued build waits with `one build at a time: <id> is <status>`); the free slots go
  to the active run's parts. The Claude setting `builds.maxParallel` ("Max parallel builds", default 3, up to 4 in
  practice) is retired: its value is kept but no longer read (`RETIRED_SETTINGS` in `pipeline-core.mjs`, the registry
  entry says so); `parallelPerAccount` keeps meaning sessions per account (parts count as sessions).
  `pipeline-settings@1` carries `oneBuildAtATime: true` read-only: the rule, not a knob.
- The dispatcher takes the main lock in the same tick it launches (`syncMainLock` in `pipeline.mjs`: base =
  `origin/main` as fetched for the worktree; the split id is `<id>.r<runs>` until the planner writes a plan) and
  releases a lock whose build has no active run left. `plan()` reads the lock from the store meta: a fresh lock held by
  another build gates every launch; a stale one (no active run, older than 6 h) gates nothing and is released.
- Runs made before this contract have no split id: a session running without one keeps going (grandfathered until it
  exits); the gate applies to launches from now on.

## Deferred

- Phase 2: the expandable queue row with live per-part badges, the Splitting status in the table, the four API surfaces
  above, the dispatcher launching parts and the combine step.
- A part that needs Fable while the others run on Opus: planned per part (`part.model`), launched on an account with
  Fable; phase 2 decides the account per part.
- Shared files that are generated (fixtures, baked assets): today they claim like any file; a later run may mark them
  `regenerate-on-combine` so two parts may both touch them.
