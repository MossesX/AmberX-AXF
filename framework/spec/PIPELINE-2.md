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

## What Plan Studio reads back

Brett, Nov 23 2026: the orchestrator decides the real steps and files them in the builds store, the one source of truth.
Plan Studio copies nothing back: every read lays the store over its tree. The build's `planRef` names the plan item.

- While the build is in the flow (not `landed`, not archived or deleted) the plan item and everything under it are
  locked: no edit, reorder, add or delete.
- Once the build has its steps (`split` or later) the planning steps that were sent leave the plan (kept on the item's
  history, recoverable) and the build's steps are listed in their place, marked as the orchestrator's. Each shows its
  status as one of eight states and is checked off when it is `completed`:

  | State | Step | Build |
  |---|---|---|
  | Sent to orchestrator | `pending`, `pulling-main`, `ready` | `pending`, `splitting`, `split` |
  | Building | `sending`, `building` | `pulling-main` … `building` |
  | Waiting for merge | `completed` / `in-pr` while the build is not landing yet | `build-complete` |
  | Merging | built, the build at `merging-pr` or `merging-main` | `merging-pr`, `merging-main` |
  | Recompiling | built, the build at `pr-pulling-main` | `pr-pulling-main` |
  | Running CI | built, the build at `running-ci` | `running-ci` |
  | Landed | any step of a `landed` build | `landed` |
  | Failed | `failed` | `failed` |

- A build archived or deleted before it lands gives the planning steps back and unlocks the plan.

## Taps on a build or a step

One entry for every surface (the orchestrator's menu, Plan Studio's, REST `POST /pipeline/act`, MCP, the CLI
`pipeline2.mjs act <build> <action> [--step s]`, the capability `axf.build-dispatch@1` `act()`): `actBuild`. The
console sends the tap; every decision is made here, and a tap that does not fit where the build is gets a refusal with
the reason and changes nothing.

| Action | What it does |
|---|---|
| `queue` | Moves the build on now: splits it if it is not split, gives it the active place when it is next in line. A Pipeline 2.0 build has no Queue of its own, so a waiting build is never refused: the answer says where it stands. `pipeline.mjs queue` does this for a Pipeline 2.0 build. |
| `hold` / `release` | A build still before the active place (`pending`, `splitting`, `split`) keeps its place and is skipped by the line and by the watchdog until released (`pipeline.heldAt`). An emergency build is never held. |
| `retry` | `retryBuild`: the build and its failed steps leave `failed` forward where they failed; attempts reset. |
| `rebuild` | A failed step is built again (through `ready`). A build that failed in a landing run re-enters at `pr-pulling-main` (main into its PR, recompiled). Any other failed build is retried. |
| `run-ci` | A build that failed at `running-ci` or later re-enters at `running-ci`; one already there is checked on the lander's next pass. |
| `land` | The lander is asked for a pass now; a build that failed in a landing run is retried first. Refused before `build-complete`. |
| `cancel` | Archived, from any status. A session still running ends on its own and is not landed. |

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

The lander's build fields (lander@1, kept by the store on Pipeline 2.0 builds): `landing` (`normLanding`: `attempt`,
split, merged / closed PRs, CI re-runs, rules per head, CI kicks, `green` (the head CI and the rules passed on),
`fixes` (fix sessions the PR in flight has had), `lastMerge`), `failure` (`normLandFailure`: kind, the status it failed
in, attempt, retry, notBefore, the failing checks and their log tail…; builds@1 builds keep done-means-merged's
record), `landedAt`, and with `landed` the done-means-merged evidence `mergedAt` + `landed { pr, sha, mergedAt, ci:
success }`. Notes keep `by`.

A landing run counts its own failures: `landing.attempt` starts at 0 when the lander takes the build at
`build-complete`, whatever the dispatcher counted before. While the build lands, its `attempt` carries that same count,
because the attempt ceiling (`MAX_ATTEMPTS`) reads `attempt`: retries spent on building never lock a build in `failed`
while it lands. A stopped build that goes on (Brett's re-send, a PR reopened or merged by hand) leaves `failed` as a
marked reset with its reason, like every other way past the ceiling.

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
   **Hand builds** (Brett, Nov 23 2026) are the other build beside the line. A session started by hand (axHub
   `vps.build_start`, a console launch) in a worktree on `claude/<its name>` gets a record once it runs
   (`framework/cli/hand-build.mjs start`, called by `deploy/claude-headless.sh`): `flow: pipeline-2`, tag
   `hand: { at, by }`, one step `s1` already `building` in that worktree. It never waits for the active place and never
   holds it (`besideLine`; `activeBuild` leaves it out), it uses the slot its launcher booked, and the dispatcher never
   launches it: a pass only notices that its session is gone (`handBuilds`, `hand-build.mjs sweep`). Its session's end
   decides: exit 0 with commits = branch pushed, step `completed`, build `build-complete`, and the lander lands it like
   any other build; exit 0 with nothing on the branch, or stopped by hand = `archived`; anything else = `failed` at
   `building`. Neither the dispatcher nor the watchdog relaunches a hand build: started again by hand under the same
   name, the same record carries on (a reset). The dispatch gate and the model gate pass a hand launch whose record
   is on file.
   **Budgets** (build-budget@1, `framework/core/build-budget.mjs`, `framework/cli/build-budget.mjs`): every full pass
   on the host first reads the caps (Claude settings `builds.budgetPerBuildUsd` and `builds.budgetDailyUsd`; 0 = no
   cap, the default until Brett saves a number) and the spend (the headless meters). A build whose sessions have cost
   its cap, and every build with a session out once the day's sessions have cost the daily cap, is stopped: its
   sessions end, their build locks are released, its steps in a slot are `failed`, and the record carries
   `budgetStop: { at, kind, spentUsd, capUsd }` with one note and one alert naming the setting. While `budgetStop` is
   set nothing of the build is launched and the watchdog leaves it alone; while the daily cap is reached no build takes
   the active place. The stop is cleared by itself when the cap allows it again (raised, removed, a new day): a
   pipeline build then goes on, a hand build is started again by hand.
9. **Never merge a stale head.** Right before any merge, emergency or not, the PR must hold main's newest code: when
   main moved after CI went green (an emergency build landed, anything else merged; status-only commits do not count),
   the lander pulls the newest main into the PR (`landing.mainPull { head, at }`), a code conflict goes to a fix
   session on Fable, CI runs again on that head, and only then it merges. So every build that finishes after an
   emergency landing re-pulls main and re-runs CI before its own merge. Main and the PR head are read from GitHub
   again right before the merge request itself, and only `landing.green.head` (the head CI and the build rules passed
   on) merges: a head that moved, or a main that moved, sends the landing run back through `merging-pr` →
   `pr-pulling-main` → `running-ci` without a failure.
10. **GitHub's word on the PR comes first.** First thing in every lander tick (and in the builds reconciler), for
   every build with a PR in flight: a PR merged by hand is recorded (`landing.merged`, `landing.lastMerge { sha, head,
   byHand, ci }`) and the build goes on to its next PR or to `landed`; `landed` still needs CI green on that merge, so
   a hand merge without green CI stops as `hand-merge` until CI is green. A PR closed without merging stops the build
   once (`pr-closed`) until it is reopened or the build is re-sent.
11. **The landing ladder has a top.** Green means every check run on the head (all pages) ended `success` and every
   check named in the lander's `requiredChecks` has reported (success, or skipped by the CI scope). The build rules
   gate fails closed: rules that could not run get one more try, then it is an `infra` failure. Red CI: re-run the
   failed jobs once, then a fix session on Fable on the PR as it is (its brief: the PR branch, the failing checks,
   their log tail, push to that branch only); a PR of several steps is split only when the fixes are used up and the
   failing log names one step's files. After `maxFixes` fix sessions on a PR or `maxAttempts` (5, the contract's
   `MAX_ATTEMPTS`) failures in a landing
   run the build stops: `failed` with `failure.retry: hold` and `failure.needsBrett`, shown on the systems check with
   the failing check, at the back of the merge line. `node deploy/lander/run.mjs retry <build>` starts a new landing
   run. After `landed` the build's merged step branches and worktrees are removed.

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
  the orchestrator's splitter). Each step has text, minutes (1 to 15, `STEP_MAX_MINUTES`) and a suggested model (Fable or Opus; the model triage gate decides, below); the answer must pass
  `normDesign` or none of it is used. Steps run at the same time in their own worktrees, so designed steps that share
  files are joined into one row (`splitParts`) while the row stays inside the cap. The build's note says how it was split.
- Fallback, when Fable cannot answer (no credits, no login, the split provider off, an answer that does not pass):
  `fallbackDesign`, one build step per planning step (its noted minutes, capped at 15, else 15; a model noted in Plan Studio is carried as the step's `pin`), or
  one step for the whole plan when it has no planning steps. The note says why. Away from the VPS host (no logins) a
  planning-only build waits at `pending` for the host's tick instead of falling back.
- `pending` → `splitting`, a build that already has steps (sent before this change): the steps are cut into as many
  parts as there are free slots, parts never sharing files (`splitParts`). Each part is one step row (its steps' text
  joined, files merged).
- `split`: every step row exists (`pending`).
- `pulling-main` (only when no other build is active): one step at a time, its worktree is cut at
  `<worktrees>/<build>--<step>` on branch `claude/<build>--<step>` from fresh `origin/main`. Step: `pulling-main` →
  `ready`. Worktrees are cut **before** launch, never at launch.
- `assigning-models`: the VPS model triage gate (model-triage@1, `framework/spec/MODEL-TRIAGE.md`) gives every step its
  model. The orchestrator never picks one: a model a step came with is a suggestion the gate reads, a `pin` on the step
  is an explicit override the gate keeps. The steps already carry the gate's first answer from the split; here it
  answers again with what could only be measured on the host (the files that depend on the step's files). Each step
  keeps the decision (`triage`: model, rule, why) and the build's note lists them. A step whose session failed asks the
  gate again before it is sent back out (the second-try rule). Never Sonnet or Haiku. A step is never launched above
  the model on its record.
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
