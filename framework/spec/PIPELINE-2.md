# Pipeline 2.0 status contract (pipeline-2@1)

Brett, Nov 19 2026. Plan Studio 2.0 plan `pipeline-2-0-fully-autonomous-bu-d8vq`. Everything is a status, forward-only.
One source of truth: the builds store (builds@1, on Postgres via axf-data in cutover mode). The four Pipeline 2.0 parts
(status core, lander, watchdog, builds table) read and write exactly this.

- Engine (pure, shared): `framework/core/pipeline-status.mjs`
- JSON Schema: `framework/schemas/json/pipeline-2.schema.json` (the contract fields of a build and its steps)
- Plan schema (what Plan Studio may send): `framework/schemas/json/plan-build.schema.json` (plan-build@1: one build; its
  steps are planning context, not build steps)
- Fixture: `framework/spec/fixtures/pipeline-2.json`, checker `framework/spec/check-pipeline-2.mjs`
- Enforced in the store layer: `framework/cli/builds-store.mjs` → `withStore` runs `enforceFlow` on every write

## Which builds

A build is in the contract when `flow: "pipeline-2"`. Plan Studio's Send to orchestrator sets it; any write that gives a
build a Pipeline 2.0-only status (`splitting` … `merging-main`) sets it too. Builds made before keep their builds@1
statuses (`queued`, `running`, …) and the old dispatcher path; nothing migrates them.

## What Plan Studio sends (plan-build@1)

Brett, Nov 19 2026: Plan Studio steps are for planning only. Send to orchestrator hands the orchestrator ONE build: the
plan as a whole (title, body, and its open steps as planning context). The plan's steps are never turned into build
steps and need no minutes or model; a model or minutes noted on a step goes along only as a hint for the split.

- Send checks (`validatePlan` plus Plan Studio's own): a valid build id (build-id@1) that is not taken, a title,
  something to build (open steps or a body), no repeated or empty step text, and no other build from the same plan item
  that is still pending, split, active or failed (it must land or be archived first).
- Send writes one build: `flow: pipeline-2`, status `pending`, `steps: []`, `planning: [{ text, model?, minutes?,
  files? }]` (the store keeps `planning` on Pipeline 2.0 builds, `normPlanning`).

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
   the store, and the refusal is strict: nothing of that write is kept for that build (rule 10). Nobody gets a silent no.
2. **failed / attempt N.** `failed` may be entered from any status except the last (`landed` / `in-pr`). It keeps the
   attempt it failed on and records `failedFrom`. A retry leaves `failed` to `failedFrom` or later, never earlier, as
   attempt N + 1. There is no bench: a failed launch or a usage-limit exit retries at once on another account.
   **The attempt ceiling** (`MAX_ATTEMPTS`, 5) is the contract's, so every writer is covered (the dispatcher, the main
   pull, the lander, the watchdog): a record failed at attempt 5 has given up, and no move out of `failed` is accepted
   except a **reset**: `transition(…, { reset: true, why })`, which starts the count again at 1 and marks its log line
   `reset: true` with the reason. Two resets exist: Brett's retry (`orchestrator.mjs retry <build>`, the console's
   Retry: the build and its failed steps) and the watchdog's one escalation of an Opus step to Fable. A setting may lower
   the ceiling (the watchdog's `maxAttempts`), never raise it.
   A build that failed while it waited its turn (`failedFrom: split`) with attempts left is activated like any waiting
   build.
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
6. **Leaving the flow.** `archived` (or a soft delete) removes a build from the table; that is the only way out, and
   it is not a way back: an archived build keeps `archivedFrom` (and `failedFrom`, `attempt`) and returns only to the
   status it was archived from, or to `failed` from it, exactly as it left. It never returns into the active place while
   another build holds it. Only a build with no `flow` and no status log (a builds@1 build joining) may enter the flow at
   any status; one that is in the flow but lost its status continues from the last status its log shows.
8. **Emergency builds** (Brett, Nov 20 2026). A build carrying `emergency: { at, by }` was sent to emergency by Brett
   from his own signed-in console (`framework/cli/emergency-builds.mjs`: the console server's `AXF_APPROVER` +
   `AXF_APPROVER_VIA=console` for his click; a session, an agent, the console token, MCP, voice and an axHub approval
   are refused). It is the one exception to rule 4:
   - **The line.** It never waits for the active place and never holds it: once `split` it goes to `pulling-main` at
     once and runs beside the active build (`emergencyBuilds`; `activeBuild` leaves it out, so it is never a breach).
   - **Slots.** Its steps go to the emergency slot pool: `emergencySlots` places (default 2) counted apart from the hard
     limit's `maxBuilds` by `framework/cli/build-limit.mjs` and the slot queue (`framework/cli/agent-slots.mjs`). A
     session is in that pool when its name is `axf-<build>--<step>` of a build holding an emergency grant
     (`grantEmergency`, owner only). The pools never lend: the orchestrator never uses an emergency slot, an emergency
     build never takes an orchestrator slot. The host runs at most `maxBuilds + emergencySlots` builds.
   - **The merge line.** The lander picks emergency builds first (oldest tag first), ahead of a build already landing.
9. **Never merge a stale head.** Right before any merge, emergency or not, the PR must hold main's newest code: when
   main moved after CI went green (an emergency build landed, anything else merged; status-only commits do not count),
   the lander pulls the newest main into the PR (`landing.mainPull { head, at }`), a code conflict goes to a fix
   session on Fable, CI runs again on that head, and only then it merges. So every build that finishes after an
   emergency landing re-pulls main and re-runs CI before its own merge.

10. **Refusals are whole.** `enforceFlow` is strict: when any part of a write breaks the contract for a build (its
    status, a step's status, its steps), the whole write is dropped for that build. The record stays as it was, gets one
    note (`Store: refused a write by <who>, nothing of it was kept: …`, never the same note twice in a row), the refusal
    goes to stderr and the journal line, and `withStore` returns it in `refused` / `flowRefused`. `setFlowStatus` and
    `orchestrator.mjs act` throw on it. Other builds in the same write are not affected. `withStore(fn, { strict: false })`
    keeps the old behaviour (content kept, status dropped) for a caller that asks for it.
11. **Steps are fixed once split.** From `split` on (and for a build that failed or was archived there or later) no
    step is removed and none is replaced by another (steps are matched by `uid`, then by `id`); past `split` none is
    added either (a build still waiting at `split` may take a new step). The one way to change them is the explicit
    re-split, legal only while the build waits at `split` and no step is past `pending`:
    `setFlowStatus(id, 'split', { resplit: true, why, mutate })`. The Steps view's divide, harvest and Restore default
    refuse a split build up front with the reason (`stepsEditRefusal`).
12. **Every step has a status.** A step that arrives without one keeps the one it had; a new step enters at `pending`.
    The "every step …" tests (`everyStep`: every step has main, every step completed) ignore skipped steps
    (`skip: true`), and the dispatcher treats a step with no status as `pending` (it gets main and a slot).
13. **One step cap.** `STEP_MAX_MINUTES` (15) is the only step-size limit: the split prompt asks for it, `normDesign`
    refuses a design over it, `fallbackDesign` caps at it, `splitParts` never joins steps past it (steps that share
    files and would pass it stay separate rows), the builds@1 rules default (`maxStepMinutes`) reads it, and the
    watchdog calls a `building` step hung at twice its own estimate with a silent log (`stepBudgetMinutes`).
14. **One owner of the status.** No builds@1 code derives a status for a Pipeline 2.0 build: the store core asks
    `ownsStatus(b)` at every derivation site (a ticked step, a Pending-list edit, the plan, an applied draft).
15. **One watchdog, one dispatcher.** Pipeline 2.0 builds are dispatched only by `pipeline2.mjs` (inside the
    orchestrator tick) and watched only by `deploy/watchdog` (layers 2 and 3), which imports this contract and has no
    status lists, budgets for waiting, or forward-only rules of its own. A build waiting at `split` is never stuck while
    any build holds the active place (`holdsActive`: a failed one holds it too). The builds@1 recovery watchdog and
    stale-row watchdog skip Pipeline 2.0 builds, and the builds@1 planner runs only while a builds@1 build is queued or
    building.

## Orchestrator flow (status core)

- `pending` → `splitting`, a build with no build steps (every build Plan Studio sends): Fable designs the build steps
  from the title, body and `planning` (`p2SplitPrompt` in the orchestrator's pipeline-core, asked once on Fable through
  the orchestrator's splitter). Each step has text, minutes (1 to 15, `STEP_MAX_MINUTES`) and a model (Fable or Opus); the answer must pass
  `normDesign` or none of it is used. Steps run at the same time in their own worktrees, so designed steps that share
  files are joined into one row (`splitParts`) while the row stays inside the cap. The build's note says how it was split.
- Fallback, when Fable cannot answer (no credits, no login, the split provider off, an answer that does not pass):
  `fallbackDesign`, one build step per planning step (its noted minutes, capped at 15, else 15; model by `modelFor`), or
  one step for the whole plan when it has no planning steps. The note says why. Away from the VPS host (no logins) a
  planning-only build waits at `pending` for the host's tick instead of falling back.
- `pending` → `splitting`, a build that already has steps (sent before this change): the steps are cut into as many
  parts as there are free slots, parts never sharing files (`splitParts`). Each part is one step row (its steps' text
  joined, files merged).
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
