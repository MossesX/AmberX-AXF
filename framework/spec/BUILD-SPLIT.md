# BUILD-SPLIT — one build at a time, split to fill every slot (split-plan@1)

Status: contract since Nov 25 2026 (build `one-build-time-always-split-to-fill`, step s1, Fable).
Brett, Nov 18 2026: "ONE build at a time on the VPS. The splitter breaks it into as many parallel parts as there are
free slots, parts never touch the same files; each part gets its own branch and slot and starts from current main. When
all parts finish they are combined into one branch, one CI run, one landing (all or nothing)."

- JSON Schema: `framework/schemas/split-plan.json` (the record, its parts, the run, the main lock, a gate rejection).
- Reference engine (pure, IO-free): `framework/core/build-split.mjs` (`planParts`, `sealOf`, `splitIdOf`,
  `validatePlan`, `partTransition`, `runTransition`, `rollUp`, `combineReady`, `checkStart`).
- Fixture and checker: `framework/spec/fixtures/build-split.json`, `node framework/spec/check-build-split.mjs`
  (`--write` regenerates the expected outputs).
- Store: the plan lives on the builds@1 record (§2). The builds store stays the one source of truth.
- Sits on top of the Pipeline 2.0 status contract (`framework/spec/PIPELINE-2.md`): §7 maps every state here to a
  pipeline-2@1 status. Nothing here adds a build status.
- Replaces the build-pipeline@1 "up to 4 builds" rule and the `orchestrator-auto-split-tab` build.
- No Kotlin or Python twin: the splitter runs only on the VPS (PORTING.md, deferred).

## 1. Words

| Word | Meaning |
|---|---|
| **split** | One pass of the splitter over one build. Its result is one split plan with one split id. |
| **part** | One parallel share of the build: a set of the build's steps, the files they claim, one branch, one slot. |
| **run** | The plan being carried out: from the split to Finished or Failed. One run per split id. |
| **combine branch** | The build's own branch (`claude/<build>`): every part branch merged into it, one PR, one CI run. |
| **main lock** | The record that says main belongs to the active run. Nothing else merges into main while it is held. |

## 2. Where it lives

Two optional fields on the builds@1 record, both absent on every build made before this contract (the migration is a
no-op; `normBuild` carries them over untouched):

| Field | Value |
|---|---|
| `splitId` | The id of the build's current plan (§3). The gate reads this one field. |
| `split` | The split-plan@1 record (§4). `split.id` always equals `splitId`. |

The record is written when the splitter finishes, already sealed. While the splitter is still working the build has
no plan: its Pipeline 2.0 status is `splitting`, and that is what `rollUp` reports (§6a). A split that fails leaves no
plan either: the build is `failed` from `splitting` with the reason in its note.

A build has at most one current plan. A re-split writes a new plan with a new id and names the old one in
`supersedes` (§9); the old id is dead from that write on.

## 3. Split id

```
sp-<time>-<seal>          ^sp-[0-9a-z]{8,9}-[0-9a-f]{8}$
sp-mwvxvn5s-b6bbfa31
```

- `<time>` = the split's `at` in milliseconds since the epoch, base 36, lower case.
- `<seal>` = FNV-1a 32-bit (offset `0x811c9dc5`, prime `0x01000193`, over the UTF-8 bytes) of the **seal text**, as 8
  lower-case hex digits. The seal text is these lines joined with `\n`, no trailing newline:

  ```
  split-plan@1
  <build id>
  <part id>|<branch>|<step ids, plan order, joined with ",">|<files, sorted, joined with ",">     (one line per part, plan order)
  ```

  Worked example (build `my-build`, split at 1795600000000 ms): the seal text

  ```
  split-plan@1
  my-build
  p1|claude/my-build--p1|s1,s3|a.md,b/
  p2|claude/my-build--p2|s2|
  ```

  hashes to `b6bbfa31`, so the id is `sp-mwvxvn5s-b6bbfa31`.
- The plan stores the same value in `seal`. `sealOf(plan)` recomputes it; `splitIdOf(plan)` builds the id.
- The seal covers what the splitter decided and nothing that changes afterwards (statuses, slots taken, the base sha,
  the run). A plan whose parts were edited by hand no longer matches its id and is refused.
- The id is a reference, not a secret. The proof that a start went through the splitter is the store: the id presented
  must be the build's `splitId`, and the plan on file must recompute to it (§8).
- At most 21 characters; safe in a branch name, a file name, a URL and an environment variable.

## 4. The plan (split-plan@1)

| Field | Type | Rule |
|---|---|---|
| `$axf` | `split-plan@1` | |
| `id` | split id | = the build's `splitId` |
| `build` | build id (build-id@1) | the record it sits on |
| `at`, `by` | time, who | when the splitter finished and who ran it (`orchestrator`, `resplit:<who>`) |
| `seal` | 8 hex | §3 |
| `baseSha` | sha or `""` | main's sha the run is built from. Empty until the run takes the main lock (§6); then fixed. |
| `combineBranch` | branch | `claude/<build>` |
| `fill` | `{ slots, groups, parts }` | what the splitter saw: free slots, independent file groups, parts made (§5) |
| `parts` | part[] | 1 to 12, plan order (§4a) |
| `run` | run | the overall state (§6) |
| `supersedes` | split id | the plan this one replaced, when it is a re-split |
| `note` | text | how it was split, in one line |

### 4a. A part

| Field | Type | Rule |
|---|---|---|
| `id` | `p1` … `p12` | `p<n>`, n = its place in the plan, from 1, no gaps |
| `title` | text | one line for the expanded row |
| `steps` | step id[] | the build's steps this part builds, at least one. Every open step of the build is in exactly one part. |
| `files` | path[] | every file the part may change (the union of its steps' `files`), repo-relative, sorted, no duplicates. May be empty. |
| `branch` | branch | `claude/<build>--<part id>`, e.g. `claude/my-build--p3` |
| `slot` | whole number ≥ 1 | the part's lane in the run, unique in the plan, 1 … `parts.length`. What the expanded row shows. |
| `baseSha` | sha or `""` | always equal to the plan's `baseSha`: every part starts from the same main |
| `model` | `Fable` / `Opus` | the highest model any of its steps is pinned to; the part is never launched above it |
| `status` | part status (§5a) | starts at `waiting` |
| `statusAt`, `statusBy` | time, who | stamped on every change |
| `attempt` | whole number ≥ 1 | 1 on the first build, +1 on every rebuild |
| `session` | `{ slotId, account, tmux, worktree, startedAt, heartbeatAt }` | the live session: `slotId` is the agent-slots entry holding the lane. Absent while `waiting`, kept after the end as the last one. |
| `head` | sha or `""` | the part branch's head when it reported `done` |
| `failure` | `{ kind, text, at }` | why it is `failed` (`session`, `tests`, `launch`, `timeout`, `cancelled`) |
| `log` | `{ status, at, by, attempt, why? }[]` | last 30 changes |

Rules (`validatePlan`, every one named in its refusal):

1. **No shared file.** A path appears in at most one part's `files`. A directory claim (a path ending in `/`) claims
   everything under it, and clashes with any path under it in another part.
2. **Every step once.** Every open step of the build (not done, not skipped) is in exactly one part; a part names no
   step the build does not have.
3. **Steps that share a file share a part.** Two steps with a common file are never in different parts. A step with no
   `files` clashes with nothing.
4. **Dependencies stay inside a part.** A step and every step it names in `after` / `dependsOn` are in the same part,
   in their build order. Parts never wait for each other. A step with no list is independent: Pipeline 2.0 steps run
   at the same time (PIPELINE-2.md, Orchestrator flow), so the builds@1 implicit previous-step edge does not apply.
5. **Ids, branches and slots are the plan's**: `p1` … `pN` in order, branch `claude/<build>--<id>`, slots a permutation
   of 1 … N.
6. **One base.** Every part's `baseSha` equals the plan's.
7. **The seal matches** (§3).

## 5. Filling the slots

`planParts(build, freeSlots, fileClaims)`:

1. Group the open steps: steps joined by a shared file or by a dependency are one **group** (the connected components
   of rules 3 and 4). `fill.groups` = how many.
2. Parts made = `min(freeSlots, groups, 12)`, never less than 1. `fill.slots` = `freeSlots` as given,
   `fill.parts` = parts made. When `groups ≥ freeSlots`, every free slot gets a part: the plan fills them all.
3. Groups are dealt to parts largest first, each to the part with the fewest estimated minutes so far (ties: the lower
   part number). Inside a part the steps keep their build order.
4. `fileClaims` are files something outside the build holds right now (an emergency or hand build beside the line). A
   group touching one is still planned; the plan's `note` names the clash and the start waits for it (§8,
   `files-claimed`).
5. `freeSlots` is the orchestrator pool's free count (agent-slots@1; the emergency pool is never counted). With one
   build at a time that is the whole pool unless a hand or emergency session holds a place.

The splitter never makes a part with no steps, and never fewer parts than rule 2 allows: a plan with
`fill.parts < min(fill.slots, fill.groups, 12)` is refused (`under-filled`).

### 5a. Part status

`waiting` · `building` · `testing` · `rebuilding` · `failed` · `done`

| Status | Shown as | Means | Badge moves |
|---|---|---|---|
| `waiting` | Waiting | planned; no session yet (the run has not started, or its slot is being taken) | yes |
| `building` | Building | its session is in its slot, first attempt | yes |
| `testing` | Testing | the session is running the part's checks | yes |
| `rebuilding` | Rebuilding | building again after a failed attempt or failed checks (`attempt` ≥ 2) | yes |
| `failed` | Failed | the attempt ended badly | no |
| `done` | Done | committed and pushed on its branch, checks passed, `head` recorded | no |

Working = `waiting`, `building`, `testing`, `rebuilding` (`PART_WORKING`): the badge is animated only for these.
Settled = `failed`, `done`: a static badge.

Allowed moves (`partTransition`; anything else is refused with the reason and changes nothing):

| From | To |
|---|---|
| `waiting` | `building`, `failed` (the launch could not happen, or the run was cancelled) |
| `building` | `testing`, `done`, `failed` |
| `testing` | `done`, `rebuilding` (checks failed, the same session fixes it), `failed` |
| `rebuilding` | `testing`, `done`, `failed` |
| `failed` | `rebuilding` (a new session, `attempt` + 1), only while `attempt` < 5 and the run is `building` |
| `done` | nothing |

- `rebuilding` always raises `attempt` by one. The ceiling is the Pipeline 2.0 one (`MAX_ATTEMPTS`, 5): a part
  `failed` at attempt 5 has given up.
- `done` needs a `head`. A part that ends with nothing on its branch is `failed` (`session`), not `done`.
- A part with a live session and a `heartbeatAt` older than the watchdog's budget is `failed` (`timeout`) by the
  watchdog, then rebuilt like any other.
- Who writes it: the part's own session through `builds-live` (`building`, `testing`, `rebuilding`, `done`,
  `failed`), the dispatcher (`waiting` → `building` at launch, `failed` → `rebuilding`), the watchdog (`failed`).

## 6. The run

`splitting` · `queued` · `building` · `combining` · `ci` · `merging` · `merged` · `live` · `finished` · `failed`

| # | State | Shown as | Means | Moved here by |
|---|---|---|---|---|
| 1 | `splitting` | Splitting | the splitter is working; no plan yet (§2). Pending tab, animated split icon. | orchestrator, at intake |
| 2 | `queued` | Queued | the plan is sealed; every part `waiting`; the run has not taken main | orchestrator, when the plan is written |
| 3 | `building` | Building | main is locked, `baseSha` set, part branches cut; parts are in their slots | dispatcher |
| 4 | `combining` | Combining | every part `done`; the part branches are being merged into the combine branch | dispatcher |
| 5 | `ci` | Running CI | the combine branch is one PR; its one CI run is going | lander |
| 6 | `merging` | Merging | CI is green; the PR is merging into main | lander |
| 7 | `merged` | Merged | the merge commit is on main (`run.mergedSha`) | lander |
| 8 | `live` | Live | the deploy of that commit was seen (`run.liveAt`) | lander / deploy watcher |
| 9 | `finished` | Finished | closed out: main lock released, part branches and worktrees removed | lander |
| – | `failed` | Failed | the run ended without landing, or its deploy was never seen | whoever saw it fail |

`run` fields: `state`, `stateAt`, `stateBy`, `startedAt` (entered `building`), `pr`, `ciRunUrl`, `combineHead`,
`mergedSha`, `mergedAt`, `liveAt`, `finishedAt`, `failedFrom`, `failure { kind, text, at, part? }`, `log`
(`{ state, at, by, why? }[]`, last 40).

Rules (`runTransition`):

1. **Forward-only.** A run moves only to a later state, one step at a time, except `failed`. No state is skipped: the
   queue row shows every one.
2. **`failed`** may be entered from `queued` … `merging`, and from `merged` (the deploy was never seen:
   `deploy-timeout`; the code is on main and stays there). It records `failedFrom`. `finished` and `failed` are final:
   a failed run is never resumed, because main moves on once the lock is released. Trying again is a re-split (§9).
3. **`queued` → `building`** needs the main lock taken by this split and no other run active (§6a).
4. **`building` → `combining`** needs `combineReady`: every part `done` with a `head`. Never with a part missing.
5. **All or nothing.** Only the combine branch ever reaches main, in one PR, with one CI run. A part branch is never
   merged into main and never gets a PR of its own. When the run fails, nothing of it has landed (except rule 2's
   `merged` case, where all of it has).
6. **What fails a run** (`failure.kind`):

   | Kind | When |
   |---|---|
   | `split-failed` | the splitter could not produce a valid plan (no plan is stored; reported by the roll-up only) |
   | `part-failed` | a part is `failed` at attempt 5 (`failure.part` names it) |
   | `combine-clash` | merging the part branches hit a conflict (it should not: parts share no file) |
   | `ci-red` | the lander's ladder for the one CI run is used up (PIPELINE-2.md rule 11) |
   | `merge-rejected` | GitHub refused the merge and the retries are used up |
   | `deploy-timeout` | merged, but the deploy was not seen in time |
   | `cancelled` | cancelled by hand (confirmed) |
   | `infra` | the host could not carry on (no worktree, no slot pool, store refused) |

7. On `failed` every part still working is set `failed` (`cancelled`), its session is ended, and the main lock is
   released. Part branches are kept for reading until the build is re-split or archived.

### 6a. Roll-up

`rollUp(plan, build)` gives the main row's status. From `combining` on it is `run.state`. Before that it is read from the
parts, so the row is right even between two ticks:

| Parts | Row |
|---|---|
| no plan, build status `splitting` | `splitting` |
| no plan, build `failed` from `splitting` | `failed` (`split-failed`) |
| all `waiting`, no `baseSha` | `queued` |
| any part `failed` at attempt 5 | `failed` |
| all `done` | `combining` |
| anything else | `building` |

It also returns the counts the row shows: `{ state, parts, waiting, building, testing, rebuilding, failed, done,
working }`, where `working` is true while any part is in a working status or the run is in `splitting`, `combining`,
`ci` or `merging` (the main row's badge is animated only then).

### 6b. One run at a time and the main lock (main-lock@1)

- **One active run.** A run is active from `building` through `live` (`RUN_ACTIVE`), until it is `finished` or `failed`. The dispatcher starts
  a `queued` run only when no run is active; the others wait at `queued`, by priority then queue time.
- **The lock**: `{ $axf: main-lock@1, build, splitId, sha, at, by }`, one record for the host. Taken in the same store
  write that moves the run to `building`; `sha` is main's head at that moment and becomes `baseSha` on the plan and on
  every part. Released at `finished` or `failed`.
- While it is held, nothing merges into main but this run's own PR, and no part pulls main again: `baseSha` is the one
  base for the whole run.
- The one exception is Pipeline 2.0's (PIPELINE-2.md rule 8): an emergency build may land beside the line. Main then
  moved under the lock; the lander's "never merge a stale head" rule (rule 9) brings the newest main into the combine
  PR and runs CI again before the merge. `baseSha` is not rewritten.

## 7. Mapping to Pipeline 2.0

The run state is a view over the pipeline-2@1 build status; the three states past `landed` live only on `run`.

| Run state | pipeline-2@1 build status |
|---|---|
| `splitting` | `splitting` |
| `queued` | `split` |
| `building` | `pulling-main`, `assigning-models`, `ready`, `sending`, `building` |
| `combining` | `build-complete`, `merging-pr`, `pr-pulling-main` |
| `ci` | `running-ci` |
| `merging` | `merging-main` |
| `merged`, `live`, `finished` | `landed` |
| `failed` | `failed` |

A part is one step row of the Pipeline 2.0 build (PIPELINE-2.md, Orchestrator flow):

| Part status | pipeline-2@1 step status |
|---|---|
| `waiting` | `pending`, `pulling-main`, `ready`, `sending` |
| `building` | `building`, attempt 1 |
| `testing` | `building` (the session's own report) |
| `rebuilding` | `ready` … `building`, attempt ≥ 2 |
| `failed` | `failed` |
| `done` | `completed`, `in-pr` |

Writers move the pipeline-2@1 status and the split state in the same store write; `validatePlan(plan, build)` reports a
pair that does not fit this table.

## 8. The gate (`require-split-id`)

Gate rule `require-split-id`, on by default, shown on Gate & rules. With it on, the VPS refuses every build start that
does not carry an orchestrator build id **and** a split id that proves the start came through the splitter. The server
gate build owns the launcher's gate; this rule is one entry in its rule set, not a second gate.

A start presents `AXF_BUILD_ID`, `AXF_SPLIT_ID` and `AXF_PART_ID` (`--build`, `--split`, `--part` on the CLI).
`checkStart({ buildId, splitId, partId }, { build, lock, claims })` answers `{ ok, reason, missing[], text }`, checking
in this order and stopping at the first that fails:

| # | Reason | Refused when |
|---|---|---|
| 1 | `no-build-id` | no build id, or not a build-id@1 name |
| 2 | `unknown-build` | no such build in the orchestrator's store, or it is archived or deleted |
| 3 | `no-split-id` | no split id |
| 4 | `bad-split-id` | it does not match the format (§3) |
| 5 | `not-split` | the build has no plan on file |
| 6 | `split-superseded` | the id is one the build's plan replaced |
| 7 | `split-mismatch` | the id is not the build's `splitId` |
| 8 | `seal-mismatch` | the plan on file does not recompute to its id (it was edited outside the splitter) |
| 9 | `unknown-part` | no part id, or the plan has no such part |
| 10 | `run-not-startable` | the run is not `queued` or `building` |
| 11 | `main-locked` | another run holds the main lock |
| 12 | `part-not-startable` | the part is not `waiting`, or `failed` with attempts left |
| 13 | `files-claimed` | a file of the part is held by something outside the build |

`missing` lists what was absent: `buildId`, `splitId`, `partId`.

A refused start is never silent. The launcher exits 3 with `text`, and the rejection is written to the store so it
shows on the orchestrator's Failed tab:

```
gate-rejection@1  { at, by, rule: "require-split-id", build, splitId, part, reason, missing[], text, host }
```

- Known build: appended to the build's `gateRejections` (last 20) with a note; the build's own status is not changed
  (a stray start must not fail a healthy run). The Failed tab lists it under that build.
- Unknown or missing build id: a row of its own on the Failed tab, status `failed`, `gateReason` = `text`.
- Both are journalled (`gate-reject`).

With the rule off the launcher starts what it is given and writes nothing; the rest of this contract is unchanged.

Emergency and hand builds (PIPELINE-2.md rule 8) run beside the line but not around the gate: each gets a plan from the
same splitter before its start (a hand build's is one part, written by `hand-build.mjs start`), so the rule has no
exemption list.

## 9. Re-split and cancel

- **Re-split** (`POST /split/<id>/resplit`, `pipeline.mjs resplit`): allowed while the run is `queued` or `failed` (a build
  whose split failed is split again by the same call). The splitter runs again with the free slots of that moment and writes a new plan: new id, `supersedes` =
  the old id, every part `waiting`, run `queued`. Part branches of the old plan are removed first. Refused while the
  run is `building` … `live` (cancel it first) and once it is `finished`.
- **Cancel** (`POST /run/<id>/cancel`, needs confirm): the run goes to `failed` (`cancelled`) from `queued` …
  `merging`. Refused from `merged` on: the code is on main. A build still `splitting` is cancelled as a build
  (PIPELINE-2.md, `cancel`).
- A build still `queued` when a slot count changes is not re-split by itself; the plan it has is valid for any number
  of free slots (parts beyond the free count wait at `waiting` for a lane).

## 10. Surfaces

The plan is state on the build record, so every surface reads the same thing:

| Surface | Read | Act |
|---|---|---|
| REST | `GET /split/<id>` (plan, parts, run, roll-up), `GET /run/active` | `POST /split/<id>/resplit`, `POST /run/<id>/cancel`, `GET` / `PUT` the gate rule |
| MCP | `pipeline-split`, `pipeline-run-status` | `pipeline-resplit`, `pipeline-cancel` |
| CLI | `pipeline.mjs split <build>`, `pipeline.mjs run` | `pipeline.mjs resplit <build>`, `pipeline.mjs cancel <build>` |
| Voice | the same routes | the same routes |
| Console | Pending row (Splitting), Queue row (one expandable row; parts with slot, branch, badge) | row menu |

`<id>` is a split id or a build id (the build's current plan). Control targets: `row:<build>`, `row:<build>/part:<pN>`.

## 11. Fixtures

`fixtures/build-split.json`, every block `in` → `out`:

| Block | Cases |
|---|---|
| `plan` | more groups than slots (every slot filled), fewer groups than slots, one step, shared files joined, dependencies kept together, directory claims, 12-part ceiling |
| `seal` | the seal text and id for a fixed plan; an edited plan no longer matches |
| `validate` | each rule of §4a refused by name; `under-filled` |
| `part` | every allowed and refused move; the attempt ceiling |
| `run` | every allowed and refused move; each failure kind; no resume from `failed` |
| `rollUp` | each row of §6a, with counts and `working` |
| `start` | each reason of §8 in order; the accepted start |
| `migrate` | a build with no `split` is unchanged, field for field |
