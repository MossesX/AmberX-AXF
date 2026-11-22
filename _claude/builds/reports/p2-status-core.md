# p2-status-core: Pipeline 2.0 part 1 of 4 (status core + orchestrator flow)

Branch `claude/p2-status-core`. Not merged: the four parts land together as one PR.

## What it does

1. **Contract as a spec.** `framework/spec/PIPELINE-2.md`, JSON Schema `framework/schemas/json/pipeline-2.schema.json`,
   reference engine `framework/core/pipeline-status.mjs`, fixture `framework/spec/fixtures/pipeline-2.json`, checker
   `framework/spec/check-pipeline-2.mjs` (36 checks). PORTING.md has the Kotlin twin as a deferred gap.
2. **Forward-only in the store.** `builds-store.mjs` `withStore` runs `enforceFlow` on every write. A backward move on a
   Pipeline 2.0 build or step is refused: the old status stays, and the refusal goes to stderr and the journal note. A
   forward move someone made by hand gets `statusAt` / `statusBy` / a `statusLog` line stamped. New API
   `setFlowStatus(id, to, { step, by, why, extra })` and CLI `builds-store.mjs flow <build> <status> [--step s] …`.
3. **Plan Studio.** Every plan must pass plan-build@1 (`framework/schemas/json/plan-build.schema.json`) before Send to
   orchestrator. That means a build id, a title, at least one step, every step Opus or Fable, an estimate, and 30 min or
   less. Every failing reason is listed. `tree.mjs validate <item>` shows the build id the plan gets and what is wrong.
   Send writes the build into the builds store as `flow: pipeline-2`, status `pending`. It no longer writes
   orchestrator.json.
4. **Orchestrator flow** (`apps/console-web/plugins/build-orchestrator/pipeline2.mjs`):
   - pending → splitting → split. Steps are cut into at most as many parts as there are slots, and parts never share files.
   - split → pulling-main, only when no build is active.
   - Each step's worktree is cut one at a time at `<worktrees>/<build>--<step>` on `claude/<build>--<step>`, from
     fresh `origin/main`.
   - assigning-models (Fable where needed, Opus otherwise) → ready.
5. **ready starts by itself, from three triggers:** the cron tick (`pipeline.mjs tick` calls `advance()`), the store
   change event (new build-hook@1 listener `pipeline2-hook.mjs`), and every step exit.
6. **Accounts** (`deploy/claude-workers.mjs`, `deploy/claude-headless.sh`):
   - The real reset is read from the message: date, weekday, time zone, "in N days", epoch, ISO, or the stream's
     `resetsAt`. The account is benched until then. A weekly limit with no reset in the message is benched a day, not 5 h.
   - Every run records its last `rate_limit_event` as usage left. An account with no usage left is out. A `rejected`
     event benches it until its reset.
   - An asked-for `--account` that is out is never used. Any account that hits a limit is marked out, not only workers.
   - The dispatcher picks the account with usage left that has the fewest of this build's steps.
7. **Dispatch:**
   - Steps go out one at a time to free slots, and the dispatcher never waits for every slot.
   - A launch failure or a usage-limit exit retries forward at once on another account as attempt N + 1. An account that
     refused a launch gets no other step in that pass.
   - The 3-fails-per-hour bench is removed, from the builds@1 path too.
   - Launch never cuts a worktree. If a worktree has vanished, the dispatch pass cuts it again before launching.
   - Dispatch tokens are per step.
8. **One active build:**
   - Active means pulling-main through merging-main, or failed from one of those.
   - Only one build may be active. The next one waits at `split` and says what it is waiting for.
   - While a Pipeline 2.0 build is active, the builds@1 dispatcher launches nothing new.

## Decisions (nobody to ask)

- **Field.** The contract lives on the existing `status` field, so the other three parts can read `b.status`.
  `flow: 'pipeline-2'` marks the builds that follow it. Builds made earlier keep their builds@1 statuses and the old
  path, and nothing migrates them.
- **Step fields.** `status`, `statusAt`, `statusBy`, `attempt`, `failedFrom`, `statusLog`, `model`, `account`, `slot`,
  `prNumber`, `worktree`, `branch` and `tmux`. `tmux` is the session name, because `session` was already taken
  (same/new).
- **Retries.** A retry may re-enter at the status it failed at. "Never back" means never earlier than `failedFrom`.
- **failed.** May be entered from any status except the last one (`landed` for a build, `in-pr` for a step).
- **Split size.** Split uses the agent-slots cap (never above the hard limit), not the slots free at that moment.
  Otherwise a busy VPS would always split into one step.
- **Step sessions.** They run with `AXF_ACCOUNT_SWITCHES=0`. On a limit the session exits, the launcher marks the
  account out, and the dispatcher relaunches on another account as attempt N + 1. The attempt and account on the store
  stay true.
- **Completion.** A step session that exits cleanly means `completed`. Sessions push their branch and never open a PR;
  the lander merges every step's branch into one PR.
- **No build record.** There was no orchestrator build record for `p2-status-core`, so `act step` and `builds-live link`
  had nothing to tick or link.

## For Fable review (contract and schema changes)

- `framework/core/pipeline-status.mjs`: new reference engine (statuses, transition rules, enforceFlow, splitParts,
  modelFor, pickAccount, activeBuild, plan-build@1).
- `framework/schemas/json/pipeline-2.schema.json` and `plan-build.schema.json`: new.
- `framework/plan/builds-store-core.mjs`:
  - `STATUSES` now = builds@1 + the Pipeline 2.0-only statuses (`LEGACY_STATUSES` keeps the old list).
  - `normStep` and `normBuild` keep the contract fields.
- `framework/core/build-hook.mjs`: `BUILD_STATUSES` gains the Pipeline 2.0 statuses. `schemas/build-hook.json` and
  `build-event.schema.json` were regenerated.
- `framework/cli/dispatch-gate.mjs`: `SLOT_STATUSES` gains `sending` and `building`, and the new `tokenKey` makes tokens
  per step (`<build>--<step>`).
- `framework/cli/model-gate.mjs`: `findBuild` resolves a `<build>--<step>` session to its build.
- `deploy/claude-workers.mjs`: worker-state.json gains `usage`, status rows gain `usage` and `usageLeft`, and limits gain
  `resetFrom`.
- Contract question for the lander part: `landed` still goes through the done-means-merged@1 guard. It needs `pr`,
  `mergedAt`, `landed.sha` and `landed.ci: success`, or the store refuses it.

The last four files are outside the brief's file list. The launch path can't work without them, and each change is the
smallest one that does.

## Checks

| check | result |
|---|---|
| `framework/spec/check-pipeline-2.mjs` | 36/36 |
| `build-orchestrator/test/p2-flow.test.mjs` (new, end to end) | 26/26 |
| `build-orchestrator/pipeline.test.mjs` | 66 passed |
| `build-orchestrator/test.mjs` | 35 passed |
| `build-orchestrator/test/launch-retry.test.mjs` | 5 passed |
| `plan-studio-2/test.mjs` | 17 passed |
| `check-build-pipeline` | 154/154 |
| `check-build-lock` | 8 |
| `check-agent-slots-data` | 6 |
| `check-agent-slots` | 56/56 alone (51/56 with 5 checks in parallel: tmux timing under load) |
| `check-build-limit` | 52/52 alone (50/52 in parallel: same timing) |
| `check-build-hook` | 26 with `--max-old-space-size=4096` (the default heap OOMs on this VPS) |
| `deploy/claude-workers.test.mjs` | the new pipeline-2@1 block passes; the end-to-end launcher part was refused by the VPS hard build limit (6/4 running: the live builds), so it is environment |
| `check-builds-store.mjs` | fails at "history reads the journal home" with ENOBUFS calling axf-data on the real 14 MB journal: environment, not this change |
| `plugin-lifecycle check build-orchestrator` | flags `.axf-focus.json` (git-ignored, auto-written by the watch-live hook): false positive |

## Not done here (owned by the other parts)

- Builds table and badges: p2-ui.
- One-PR landing and the size cap: p2-lander.
- Watchdog layers 2 and 3: p2-watchdog.
- Plan Studio's page still shows the send error as text. A validate preview in the UI needs UI Review with shots, and
  this part made no UI change.
