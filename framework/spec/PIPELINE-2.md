# Pipeline 2.0 status contract (pipeline-2@1)

Brett, Nov 19 2026. Plan Studio 2.0 plan `pipeline-2-0-fully-autonomous-bu-d8vq`. Everything is a status, forward-only.
One source of truth: the builds store (builds@1, on Postgres via axf-data in cutover mode). The four Pipeline 2.0 parts
(status core, lander, watchdog, builds table) read and write exactly this.

- Engine (pure, shared): `framework/core/pipeline-status.mjs`
- JSON Schema: `framework/schemas/json/pipeline-2.schema.json` (the contract fields of a build and its steps)
- Plan schema (what Plan Studio may send): `framework/schemas/json/plan-build.schema.json` (plan-build@1)
- Fixture: `framework/spec/fixtures/pipeline-2.json`, checker `framework/spec/check-pipeline-2.mjs`
- Enforced in the store layer: `framework/cli/builds-store.mjs` → `withStore` runs `enforceFlow` on every write

## Which builds

A build is in the contract when `flow: "pipeline-2"`. Plan Studio's Send to orchestrator sets it; any write that gives a
build a Pipeline 2.0-only status (`splitting` … `merging-main`) sets it too. Builds made before keep their builds@1
statuses (`queued`, `running`, …) and the old dispatcher path; nothing migrates them.

## Build statuses (in order)

| # | status | shown as | who moves it here |
|---|--------|----------|-------------------|
| 1 | `pending` | Pending | Plan Studio, Send to orchestrator |
| 2 | `splitting` | Splitting | orchestrator flow (pipeline tick) |
| 3 | `split` | Pending | orchestrator flow, once the step rows exist |
| 4 | `pulling-main` | Pulling in main | orchestrator flow: cuts each step's worktree and pulls main, one step at a time |
| 5 | `assigning-models` | Assigning models | orchestrator flow: Fable where needed, Opus otherwise |
| 6 | `ready` | Ready for build | orchestrator flow |
| 7 | `sending` | Sending to slot | dispatcher: the first step is going to a slot |
| 8 | `building` | Building | dispatcher: as soon as the first step is in a slot |
| 9 | `build-complete` | Build complete | dispatcher, when every step is `completed` |
| 10 | `merging-pr` | Merging to one PR | lander |
| 11 | `pr-pulling-main` | Pulling in main (PR) | lander |
| 12 | `running-ci` | Running CI | lander |
| 13 | `merging-main` | Merging into main | lander |
| 14 | `landed` | Landed | lander (done-means-merged@1 guard: needs `pr`, `mergedAt`, `landed.sha`, `landed.ci: success`) |
| – | `failed` | failed, attempt N | anyone who sees it fail |

## Step statuses (in order)

`pending` → `pulling-main` → `ready` → `sending` → `building` → `completed` → `in-pr` (with `prNumber`), plus `failed`
(attempt N). Each step carries `model` (Fable | Opus), `account`, `slot`, and once cut `worktree` and `branch`
(`claude/<build>--<step>`); `tmux` (the session name) while building; `tried` (accounts it failed on, last 10). `done`
mirrors `completed` / `in-pr` for older readers.

The lander's build fields (lander@1, kept by the store on Pipeline 2.0 builds): `landing` (`normLanding`: split,
merged / closed PRs, CI re-runs, rules per head, CI kicks, `lastMerge`), `failure` (`normLandFailure`: kind, the
status it failed in, retry, notBefore…; builds@1 builds keep done-means-merged's record), `landedAt`, and with
`landed` the done-means-merged evidence `mergedAt` + `landed { pr, sha, mergedAt, ci: success }`. Notes keep `by`.

## Rules

1. **Forward-only.** A status may only move to a later one in its flow (skips allowed). A backward move is refused by
   the store: the record keeps its old status fields, the refusal goes to stderr and the write's journal line
   (`builds-store: refused <id>[/<step>] <from> → <to>: …`). Nobody gets a silent no.
2. **failed / attempt N.** `failed` may be entered from any status except the last (`landed` / `in-pr`). It keeps the
   attempt it failed on and records `failedFrom`. A retry leaves `failed` to `failedFrom` or later, never earlier, as
   attempt N + 1. There is no bench: a failed launch or a usage-limit exit retries at once on another account.
   Two named re-entries (Pipeline 2.0 integration, Nov 19 2026):
   - **Relaunch.** A step that failed at `ready`, `sending` or `building` may re-enter at `ready` (`RELAUNCH_FROM`):
     watchdog layer 2 puts it there with a pinned `account` (and `tried`, the accounts it already failed on).
   - **PR groups.** A build in a landing run (`LANDING_GROUP`: `merging-pr` … `merging-main`) may start the next PR
     group at `merging-pr` (the lander's size cap and splits), and a build that failed in a landing run may retry at any
     status of that run (re-run CI, split, pull main again).
7. **Pinned account.** A step at `ready` with `account` set is sent to that account when it is not marked out and can
   take it (`pinnedAccount`, the same test as `pickAccount`); otherwise `pickAccount` chooses, never an out account.
3. **at / by.** Every status change records `statusAt`, `statusBy`, and one `statusLog` line
   `{ status, at, by, attempt, why? }` (last 60). A writer that changes `status` by hand gets them stamped by the store.
4. **One active build.** Active = `pulling-main` … `merging-main`, or `failed` from one of those. Only one build may be
   active; the next waits at `split` (shown Pending). Nothing pulls main, merges or touches main while a build is
   active, except that build's own flow.
5. **Status, never location.** The watchdog, lander, rules and gates read and act on these statuses, never on tabs,
   queues or which file a build is in.
6. **Leaving the flow.** `archived` (or a soft delete) removes a build from the table; that is the only way out.

## Orchestrator flow (status core)

- `pending` → `splitting`: the steps are cut into as many parts as there are free slots, parts never sharing files
  (`splitParts`). Each part is one step row (its steps' text joined, files merged).
- `split`: every step row exists (`pending`).
- `pulling-main` (only when no other build is active): one step at a time, its worktree is cut at
  `<worktrees>/<build>--<step>` on branch `claude/<build>--<step>` from fresh `origin/main`. Step: `pulling-main` →
  `ready`. Worktrees are cut **before** launch, never at launch.
- `assigning-models`: `modelFor` (Fable for schemas, asset types, contracts, engines / kernel, cross-app protocols, or a
  step pinned to Fable; Opus otherwise). Never Sonnet or Haiku. A step is never launched above its pinned model.
- `ready` → `sending`: started automatically by two triggers: the orchestrator tick (`orchestrator.mjs tick`, cron every
  minute; `tick --build <id>` is one build, the watchdog's nudge) and the store
  change event (build-hook@1 listener `pipeline2-hook.mjs`, which runs one advance as soon as a build reaches `ready`
  or a step ends).
- Dispatch: one step at a time to each free slot (never waiting for every slot). Account = `pickAccount`: never an
  account marked out, usage checked before routing, steps spread evenly across accounts with usage left. The launch
  only starts the session in the pre-cut worktree.
- A step's session ends: `completed` (or `failed`, attempt N, and relaunched forward on another account). When every
  step is `completed`, the build is `build-complete` and the lander takes it.

## Accounts and limits

`deploy/claude-workers.mjs`: a usage limit reads the real reset from the message (`resets Nov 21, 3am (UTC)`, a weekday,
`in 3 days`, an epoch, a time zone) and benches the account until then (no reset in the message: 5 h). A worker marked
out is never claimed, an explicit `--account` that is out is never used, and any account that hits a limit is marked
out, whatever path launched it.

## Cross-port

The engine is a reference engine; the Kotlin twin is deferred (PORTING.md). The fixture is generated from the engine
(`node framework/spec/check-pipeline-2.mjs --write`).
