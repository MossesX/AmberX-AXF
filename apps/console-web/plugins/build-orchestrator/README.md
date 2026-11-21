# Build orchestrator

Splits every build into small steps (10 min or less, pinned to Fable or Opus) and runs the build pipeline:
Pending → Queue → Building. The store is `_claude/builds/store.json`; the rules for sessions are in
`_claude/builds/README.md`.

- `orchestrator.mjs`: steps, phases, briefs, notes, approvals (`next | brief | act`).
- `pipeline.mjs`: the dispatcher on the VPS host (cron `axf-pipeline`, every minute, `flock /run/axf-pipeline.lock`).
- `watchdog.mjs`: the one build watchdog (cron `axf-build-watchdog`, every minute) and its watches in `watchdog/`: stuck or
  killed sessions recovered, builds standing in one status pushed on, left-over rows cleaned; see below.
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

## The build watchdog: one watchdog, three watches

`watchdog.mjs` (build-watchdogs@1) is the only watchdog entry in this plugin. It runs on the VPS host from ONE cron
(`axf-build-watchdog`, every minute, `flock /run/axf-build-watchdog.lock`; template `deploy/cron/axf-build-watchdog`,
installed by `install.mjs` / `deploy/install-console.sh`, which also remove the retired `axf-stale-watchdog`). Each pass
runs every watch that is on and due, writes what each caught to one log, and sends one alert.

| Watch | File | What it catches | What it does |
|---|---|---|---|
| `sessions` | `watchdog/sessions.mjs` (build-watchdog@1) | builds marked running whose session is stuck, was killed or failed | reset and requeue, retry, another account, give up past the cap (details in the next section) |
| `stale` | `watchdog/stale.mjs` + `stale-core.mjs` (stale-status@1) | builds standing in `landing`, `fixing` or `merging` past their limit with nothing moving | the next action on their ladder (table below) |
| `rows` | `watchdog/rows.mjs` (stale-row@1) | rows on Pending, the Queue, Building, the merge queue or UI Review whose PR merged or closed | completed or removed, logged in the Cleanups log |

A watch is a module exporting `WATCH = { id, label, what, schema, settings(), set(patch), scan(), run() }`; the list is
`WATCH_FILES` in `watchdog.mjs`, and `register(watch)` adds one at run time. A watch that throws or cannot load is
recorded and never stops the others. Pipeline 2.0 builds are skipped by all three: `deploy/watchdog` is their watchdog.

**The stale-status ladder** (`stale-core.mjs` `decide`, done-means-merged@1's line). "Standing" is measured from the
build's last real progress (a failure recorded, an attempt, a ticked step, a launch, the merge), never from `updatedAt`.

| Found | Action |
|---|---|
| its PR merged and the build never heard | `record-merge`: `mergedAt` + the merge commit on the build, a failure from before the merge cleared, status `landing` |
| merged, CI green on the merge commit | `land`: `landed.ci = success`, status `landed` (through `guardStatus`) |
| merged, CI on the merge commit red, cancelled or missing, but main green now with the merge in it | `land`, with `landed.ciRun = main@<sha>` naming the proof |
| merged, CI red on the merge commit and main red too (or the merge commit is main's newest) | `fail`: a `ci-red` failure at the merge commit, status `fixing` |
| merged, CI on the merge commit not green, CI on main's newest commit still running or unreadable | wait: main's result decides |
| merged, CI still running or none | wait `ciWaitMin`, then `escalate` |
| `fixing` with a failure and nothing tried | `ladder`: the retry ladder's next rung, launched now (`pipeline.mjs retryFixing`) |
| `fixing`, the ladder ran out | `escalate`: status `escalated`, banner item, one push |
| `fixing` with no failure on it | `to-landing` (every step done and a PR) or `requeue` |
| `landing` / `merging`, the PR open, closed or missing | `fail`: a `stalled` (or `push-fail`) failure; the dispatcher's retry runner answers it |

Never touched: a build with a live session, a lander fix agent or an attempt in flight; a build pushed less than
`cooldownMin` ago; a build whose PR state could not be read from GitHub (nothing is pushed blind). A pass acts on the
longest-standing builds first, at most `maxPerPass`, and starts at most `maxLaunchPerPass` sessions (default 1, so a
backlog drains one build per pass; 0 = bookkeeping only, never start a session).

**Settings** are one flat map: `enabled` (the master switch), `alerts` (`batch` / `each` / `off`; a give-up always
alerts) and each watch's own under `<watch>.<key>`: `sessions.staleMin`, `sessions.maxRetries`, `stale.limit.landing`
(90), `stale.limit.fixing` (60), `stale.limit.merging` (30), `stale.ciWaitMin`, `stale.cooldownMin`,
`stale.maxLaunchPerPass`, `rows.intervalMin`, … Each watch stores its own where it always did.

**Files** (the pipeline folder, shared with the console): `watchdogs.json` (`lastTick`, the heartbeat of every cron
minute; `lastPass`, the last time a watch ran; each watch's last run),
`watchdogs-caught.jsonl` (watchdog-catch@1: watch, build, status, cause, action, rung, ok, gaveUp, notified, note),
`watchdogs-settings.json`, `watchdogs-request.json`, `watchdogs-stale.json` (the stale watch's last push per build).

**Alerts and health.** Notify types `watchdog.caught` (FYI), `watchdog.fix` (a recovered session, FYI) and
`watchdog.gave-up` (alert). Systems check item **Build watchdog runs**: red when on and no heartbeat for 5 minutes, amber when
a watch cannot load or its last run failed; Auto fix reinstalls the cron and runs one pass (axHub `vps.run`).

| Reach it | How |
|---|---|
| Screen | Settings → Plugins → Build orchestrator → **Watchdog**: Caught, Watches (Run this watch, Dry run), Settings |
| REST | `GET watchdogs`, `GET watchdogs/caught?watch=&build=&limit=`, `GET watchdogs/scan?watch=`, `POST watchdogs/run {watch?, build?}`, `GET/PUT watchdogs/settings` |
| MCP | plugin commands `watchdogs-status`, `watchdogs-caught`, `watchdogs-scan`, `watchdogs-run`, `watchdogs-settings`, `watchdogs-settings-set` |
| CLI | `axf watchdog status\|watches\|scan [--watch id]\|run [--watch id] [--build id]\|caught\|settings\|set key=value…\|request\|install-cron` (= `node …/watchdog.mjs …`); a watch's own commands: `axf watchdog sessions requeue <id>`, `axf watchdog rows log` |
| Voice / actions | `watchdogs.status`, `watchdogs.run[:<watch>[:<build>]]`, `watchdogs.scan[:<watch>]`, `watchdogs.set:<key>:<value>`, `watchdogs.open[:caught\|watches\|settings]` (and the older `watchdog.status`, `watchdog.run[:<build>]`) |
| Deep link | `build-orchestrator.focus:watchdog[?build=<id>]`; console-control `panel:build-orchestrator.watchdogs`, `setting:orchestrator.watchdogs.<key>` |

The older per-watch routes and commands still answer (`watchdog/*` for the row cleaner, `recovery-watchdog/*` for the
session watch).

## The session watch: stuck builds fix themselves


Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking.
Detect builds marked running with no live session (e.g. killed exit 143, failed exit 1), reset and requeue them, retry
failed sessions, keep every slot filled, and send an FYI to the phone for each fix. Never wait for Brett to notice."

`watchdog/sessions.mjs` (build-watchdog@1; the decision table is `framework/core/build-watchdog.mjs`, golden cases
`framework/spec/fixtures/build-watchdog.json`) is run by the build watchdog's one cron on the VPS host. One pass:

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
5. **Fill the slots** (only with `sessions.fillSlots` on; the orchestrator tick fills them every minute): the dispatcher tick runs while slots are free and the Queue has work; slots still idle with Queue
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

## Emergency builds

Two emergency slots beside the orchestrator's (Brett, Nov 20 2026), for work he rams through by hand.

- **Start.** Only from Brett's own signed-in console: **Send to emergency** on a build's expanded row in the builds
  table (`POST pipeline/emergency {id}`), or in Plan Studio 2.0's Send dialog. The server takes it from a signed-in hub
  admin's session only; the console token (REST commands, MCP, the CLI, voice) and every session get 403. The button is
  never a toolbar button, a registered action or a console-control target, so nothing can press it for him.
- **What it does.** The build is tagged `emergency: { at, by }` and gets an emergency grant on the VPS hard limit. It
  skips the one-active-build line (`pipeline2.mjs` emergency lane) and its steps go out to the emergency slot pool:
  `emergencySlots` places (default 2), counted apart from `maxBuilds` (Settings → Plugins → Agent cap). The orchestrator
  never uses those slots for an ordinary build.
- **Landing.** The lander takes emergency builds first. Any build about to merge on a head that lacks main's newest
  code pulls main again and re-runs CI first (`framework/spec/PIPELINE-2.md` rules 8 and 9).
- **Table.** An Emergency badge on the row; emergency builds in flight sort to the top.
- `GET pipeline/emergency` lists them; `POST pipeline/emergency/clear {id}` makes one ordinary again.
  CLI: `node framework/cli/emergency-builds.mjs list | clear <build>` (`send` works only with Brett's console click).

## Tests

`node apps/console-web/plugins/build-orchestrator/test/emergency.test.mjs` (emergency builds: the console-only start,
the emergency lane beside the active build, the two pools) and `python3 …/server/test_emergency.py` (the routes: 403 for
everything but Brett's signed-in click).


`node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs` (pure rules and the CLI end to end on a scratch
store with a fake launcher), `node …/test-watchdog.mjs` (the session watch on a temp store, fake probe), `node …/test/watchdogs.test.mjs` (the one
watchdog and the stale-status table), `node …/test/watchdogs-store.test.mjs` (the stale watch's writes on a scratch store),
`python3 …/server/test_watchdogs.py` (the routes), `node …/test/watchdog.test.mjs` (the row cleaner), `bash
…/test-watchdog-e2e.sh` (a fake claude started through the dispatcher and claude-headless.sh, killed, recovered and
relaunched; needs tmux), `node framework/spec/check-build-watchdog.mjs`, `node framework/spec/check-build-pipeline.mjs`, `node framework/spec/check-builds-store.mjs`.
