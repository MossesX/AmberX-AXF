# Build orchestrator

Splits every build into small steps (10 min or less, pinned to Fable or Opus) and runs the build pipeline:
Pending → Queue → Building. The store is `_claude/builds/store.json`; the rules for sessions are in
`_claude/builds/README.md`.

- `orchestrator.mjs`: steps, phases, briefs, notes, approvals (`next | brief | act`).
- `pipeline.mjs`: the dispatcher on the VPS host (cron `axf-pipeline`, every minute, `flock /run/axf-pipeline.lock`).
- `watchdog.mjs`: the build watchdog (cron `axf-watchdog`, every minute): stuck builds reset, requeued, retried; see below.
- `pipeline-core.mjs`: the pure rules (plan, account pick, session end). Contract: `framework/core/build-pipeline.mjs`.
- `server/__init__.py`: the console REST routes (`/api/plugins/build-orchestrator/…`); `plugin.json` lists the commands
  (MCP tools, voice, CLI). `web/`: the Orchestrator view and its Pipeline tabs.

## Session end: phase done goes back to the Queue

A build's steps run in phases (a new phase where the model or the phase label changes). One headless session runs one
phase and then stops. When it ends:

| how it ended | where the build goes | reason |
|---|---|---|
| every step done | built / complete | `all-done` |
| its phase done, steps left | **Queue, same place; the next phase launches by itself** | `phase-done` |
| crash (non-zero exit, killed) | Queue, until `maxRuns` crashes (3) | `crash` |
| crash limit reached | Pending (Errors tab) | `crash-limit` |
| next phase is an upgrade Brett has not approved | Pending | `upgrade-blocked` |
| the session said it needs Brett | Pending | `needs-brett` |
| clean stop mid-phase | Pending | `stopped` |

Pending only when Brett is needed. A phase end never counts as a crash.

How it is wired:

1. The dispatcher records the phase it launches (`pipeline.phase`) and passes it to the session (`AXF_BUILD_PHASE`).
2. `deploy/claude-headless.sh` classifies the exit (0 = `phase-done`, SIGINT / SIGTERM = `stopped`, else `crash`),
   writes it on the `session-end` event, and once the agent slot is free calls
   `pipeline.mjs exit <id> --session <s> --exit <n> --kind <kind> --phase <p>` (detached, clean environment;
   `AXF_PIPELINE_EXIT=off` skips it).
3. `exit` re-runs itself under the cron's lock (`AXF_PIPELINE_LOCK`), ends the run through the builds store (journalled:
   "phase <n> done, requeued for <model>") and, when the build is back in the Queue, runs one dispatcher tick in-process,
   so a free slot and an account with the next phase's model start it at once. A run already ended is left alone, so the
   cron tick reading the same event never launches it twice. The store has the last word: a `phase-done` claim whose
   phase still has open steps lands as `stopped`.

## Repairing builds parked by the old rule

Before this, a clean phase end with steps left went to Pending and the next phase never started.
`pipeline.mjs requeue-stuck` lists those builds (dry run); `--apply` moves them back to the Queue at their place,
journalled. `builds-reconcile.mjs --apply` runs it on every pass (`AXF_RECONCILE_REQUEUE=off` skips it). Builds that
need Brett (`needs-brett`, `upgrade-blocked`, crash limit) stay where they are.

The same function on every surface:

| surface | how |
|---|---|
| CLI | `node apps/console-web/plugins/build-orchestrator/pipeline.mjs requeue-stuck [--apply] [--json]` |
| REST | `POST /api/plugins/build-orchestrator/pipeline/requeue-stuck` `{ "apply": true }` |
| MCP / AmberX voice | plugin command `pipeline-requeue-stuck` ("requeue the stuck builds") |
| console | action `build-orchestrator.requeue-stuck[:apply]`; a parked build's **Back to Queue** button |

Rows from `GET /pipeline` (MCP `pipeline-status`, `pipeline-tab`) carry `requeue` (`{ reason, phase, next, at }`, a
queued build back after a finished phase) and `stuck` (`{ phase, next, why }`, a Pending build parked by mistake). A
build's pipeline row opens with `console_show build-orchestrator <id>` (action `build-orchestrator.open:<id>`).

## Watchdog: stuck builds fix themselves

Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking.
Detect builds marked running with no live session (e.g. killed exit 143, failed exit 1), reset and requeue them, retry
failed sessions, keep every slot filled, and send an FYI to the phone for each fix. Never wait for Brett to notice."

`watchdog.mjs` (build-watchdog@1; the decision table is `framework/core/build-watchdog.mjs`, golden cases
`framework/spec/fixtures/build-watchdog.json`) runs on the VPS host from the cron `axf-watchdog` (every minute,
`flock /run/axf-watchdog.lock`; `install.mjs` / `deploy/install-console.sh` install it, `uninstall.mjs` removes it, the
line removes itself once the plugin folder is gone). One pass:

1. **Evidence.** `deploy/claude-headless.sh` records every run's end the moment claude exits (or the wrapper gets HUP /
   TERM): exit code, signal, exit kind, a usage / login stop, account, time, on the build (`pipeline.runEnd`, through
   `builds-live.mjs run-end`, live on main) and in `<slots dir>/runs/<build>.json` (`agent-slots.mjs run-end`).
2. **Probe.** Every build marked running is probed: `agent-slots.mjs alive <build>` (a claude pid in its worktree or with
   its `AXF_BUILD_ID`, its `axf-<build>*` tmux sessions, the heartbeat = newest of its log and meter) plus that evidence.
   `agent-slots.mjs reap` frees orphan slots whose process is gone.
3. **Decide** (`decide()`): killed 143 / OOM 137 / failed exit / tmux or claude gone / stale heartbeat → **retry** (a
   hung live session is killed first); exit 0 never processed → **requeue**; usage limit or dead login →
   **retry-other-account** (the account is marked out, the next worker planned); past `maxRetries` since the last
   ticked step, or every account tried → **give-up** (Pending, Errors tab, banner item, alert). A live or just-started
   build is never touched.
4. **Recover** (`run`): the step reset, its slots, worker claim and build lock released, a leftover tmux session with no
   claude closed, the build back to the Queue through `pipeline.mjs setPipeline`, with a `recoveries[]` entry in the
   same store write (journal action `watchdog-recover`). A per-build lock, a re-read under it and a cooldown keep it
   idempotent: a second pass does nothing. The retry count is the build's own recoveries (a give-up hands it to Brett;
   his requeue starts a fresh count).
5. **Fill the slots:** the dispatcher tick runs while slots are free and the Queue has work; slots still idle with Queue
   work are recorded as an `idle-slots` fix and the self-check is asked for.
6. **Tell the phone:** notify types `watchdog.fix` (FYI, pushed at normal priority: `low` never leaves the banner) and
   `watchdog.gave-up` (alert), through the console's alerts API and axf.notify@1 to AmberX, with build, cause, action
   and attempt; batched per pass or one per fix. Each sent fix gets `notified` on its record.

Files (pipeline folder, shared with the console): `build-watchdog.json` (last pass, last scan, recent fixes),
`build-watchdog-settings.json`, `build-watchdog-request.json` (a pass the console asked for). The console container
can't see the host's processes (`AXF_WATCHDOG_HOST=request`): it shows the host's last scan and hands passes to the cron.

Systems check (health@1): **Build watchdog** (red when on and the last pass is older than 3 min; Auto fix reinstalls the
cron and runs one pass, through axHub `vps.run`) and **Builds the watchdog gave up on** (Fix = Requeue, ask first).

| Reach it | How |
|---|---|
| Screen | Build orchestrator → **Watchdog** tab (last pass, running builds with liveness, recent fixes, gave up, Run now); each build's expanded row lists its **Recoveries** |
| Settings | Settings → Plugins → Build orchestrator → **Watchdog**: on/off, interval, stale heartbeat, max retries, retry on another account, FYI batched / per fix |
| REST | `GET watchdog/status`, `GET watchdog/scan`, `POST watchdog/run {build?}`, `POST watchdog/requeue {builds?}`, `GET/PUT watchdog/settings`, `GET builds/<id>/recoveries` |
| MCP | plugin commands `watchdog-status`, `watchdog-scan`, `watchdog-run`, `watchdog-requeue`, `watchdog-settings`, `watchdog-settings-set`, `build-recoveries` |
| CLI | `axf watchdog status\|scan\|run [--build id]\|set key=value…\|settings\|recoveries <id>\|requeue [id…]` (= `node …/watchdog.mjs …`) |
| Voice / actions | `watchdog.status`, `watchdog.run[:<build>]` |
| Deep link | `build-orchestrator.focus:watchdog[?build=<id>]` (console_open `build-orchestrator` focus `watchdog`; console_show `build-orchestrator/watchdog`) |

## Split runs: one build at a time, split to fill every slot (split-plan@1)

Since Nov 18 2026 the dispatcher runs ONE build at a time and splits it across every free agent slot. This replaces
the old rule of up to 4 builds side by side. Intake sets a Pending build to `splitting` and plans its parts for the free
slots (parts never share a file; split id `<build>.r<n>`). The dispatcher locks main on one sha and starts each part on
its own branch, worktree and slot (`--account`). Parts report through `builds-live.mjs part`. `combine.mjs` merges them
all or nothing into `claude/<build>`, one PR and one CI run, and the run follows ci → merging → merged → live →
finished. Gate rule `require-split-id` refuses any start without a split id (exit 3) and puts it on the Failed tab with
its gate reason. Contract `framework/spec/BUILD-SPLIT.md`; operator doc `_claude/memory/docs/build-split.md`.

| Reach | How |
|---|---|
| Screen | Pending: **Splitting** row with the split badge · Queue / Active: one expandable row (rolled-up status), expanded = parts with slot, branch and a live badge · Failed: the gate reason · Gate & rules: `require-split-id` switch |
| REST | `GET split/<build>`, `GET run/active`, `POST split/<build>/resplit`, `POST run/<build>/cancel {confirm: true}`, `GET/PUT split-gate`, `POST pipeline/split` |
| MCP | `pipeline-split-show`, `pipeline-run-status`, `pipeline-split`, `pipeline-resplit`, `pipeline-cancel`, `pipeline-split-gate`, `pipeline-split-gate-set` |
| CLI | `pipeline.mjs split <id> \| run \| resplit <id> \| cancel <id> --confirm \| split-gate [on\|off]` |
| Voice / actions | `voice.json` → `build-orchestrator.run-status`, `.split-show:<build>`, `.split:<build>`, `.resplit:<build>`, `.cancel-run:<build>\|confirm`, `.split-gate[:on\|off]` |
| Deep link | `view:builds/tab:pending`, `row:<build>` (open expands it), `row:<build>/part:<pN>` (console_show / console_open) |

## Tests

`node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs` (pure rules and the CLI end to end on a scratch
store with a fake launcher), `node …/test-watchdog.mjs` (the watchdog on a temp store, fake probe), `bash
…/test-watchdog-e2e.sh` (a fake claude started through the dispatcher and claude-headless.sh, killed, recovered and
relaunched; needs tmux), `node framework/spec/check-build-watchdog.mjs`, `node framework/spec/check-build-pipeline.mjs`, `node framework/spec/check-builds-store.mjs`. Split runs: `node …/test/pipeline-split.test.mjs`, `node …/test/combine.test.mjs`, `node framework/spec/check-build-split.mjs`.
