# Pipeline rebuild (build urgent-rebuild-pipeline-orchestrator-ids-splits-, Nov 8 2026)

Brett (voice): "You need to start the pipeline over from scratch. From now on, what I say, send a build to the orchestrator.
The orchestrator is going to assign an ID … break it up into steps, select a model … he'll send the Fable to that [account].
He'll send everything else to Opus … check the VPS to see what accounts have what slots … Dish out the steps … he sends
everything to the pending. And I have to send them from pending to queue." Addendum: "The orchestrator doesn't start a
headless session right away. If he has slots open, he grabs the next build in the queue and starts the headless session."

## What was there

- The Build orchestrator (plugin `build-orchestrator`) split nothing by itself and launched nothing: `import` copied
  sub prompts, every launch went through axHub `vps.build_start` → `deploy/claude-headless.sh` with a brief someone wrote.
- The Nov 7 build `build-pipeline-v2` was marked complete but its branch `claude/pipeline-v2` was never pushed and none
  of its code is on main (the worktree still sits in `/root/axf-builds/pipeline-v2`). Nothing of it is reused here;
  the pipeline was rebuilt on the existing orchestrator, store, launcher, slots and worker accounts as Brett asked.
- `queued` was not a build status (`planner.builds` refused it).

## The flow now

```
request (voice / chat / console / MCP / CLI) → orchestrator: build id in the one store → split (Claude, ≤ 30-min steps,
Fable only where needed) → Pending → Brett: Queue → dispatcher (every minute on the VPS): slot free + account that
runs the next phase's model → deploy/claude-headless.sh --account → Building (running) → steps tick (orchestrator →
builds-live → main) → session ends → built / Queue (next phase, or a crash) / Pending (stopped early) / failed
```

- **Contract** (`framework/core/build-pipeline.mjs`, build-pipeline@1): the `queued` status in builds@1, orchestrator@1
  and build-hook@1; the table states Pending / Queue / Building (running); a `pipeline` record on a build (queuedAt /
  queuedBy, account, session, model, launchedAt, runs, lastRun, split, splitRequested, note) that survives orchestrator,
  Pending and queue writes; the queue order (priority tag, then the moment queued); the outcome of a run.
- **Intake and split** (`pipeline.mjs intake`): every build with no steps is split by a one-shot Claude call on Opus
  (a worker account's login copy when one is free) from a prompt carrying the title, detail and Brett's verbatim words;
  the answer is JSON steps with estimates; Fable only for contracts / schemas / engines / cross-app behaviour; Fable
  steps first so the build switches model at most once. Steps someone wrote by hand are never replaced unless the
  console asks (*Split now* → `splitRequested`). When Claude can't answer, a rules split (one step per line, review
  asked) keeps the build moving.
- **Pending → Queue** is Brett's move (`pipeline.mjs queue <id>`, console button, MCP / voice command `pipeline-queue`).
  With the owner-only Claude setting *Launch builds without asking* ON, a split build queues by itself (a build a
  session handed back to Pending still waits for him).
- **Dispatcher** (`pipeline.mjs tick`, cron `axf-pipeline` every minute, `flock`): reads the saved Claude accounts
  (`deploy/claude-workers.mjs status`: role, limits, running) and the pipeline's own account records
  (`pipeline/accounts.json`: Fable override, parallel cap, use on/off; a probe can ask the login itself), the agent
  slots (`framework/cli/agent-slots.mjs`), and the Queue in order. For each free slot it picks the next Queue build whose
  next phase has an account: a Fable phase goes to an account with Fable (Max plan, override or probe), Opus work to
  accounts without Fable first so the Fable accounts stay free; per-account parallel = the Claude setting
  `builds.maxParallel` unless the account has its own cap. It makes the worktree (`/root/axf-builds/<id>`, branch
  `claude/<id>` from origin/main, node_modules linked), writes the brief (Brett said block, then the orchestrator's
  phase brief, then the pipeline's own line) and starts `deploy/claude-headless.sh --name <id> --account <acct>` with
  `--model` of the phase; the agent cap, the model gate, the origin capture and the agent booking all stay in the launcher.
- **Session ends** come from `/var/tmp/axf-headless/events.jsonl` (session-end) or a tmux session that is gone: every
  step done → built / complete (unchanged when the last tick already completed it); exit 0 with steps left at a phase
  boundary → Queue (next phase on its own account); exit 0 with steps left otherwise → Pending for Brett with the reason;
  a crash → Queue again, up to `maxRuns` (3), then failed.
- **Idle alert**: nothing running while the Queue has work (with why: no free account, no Fable account, parallel cap,
  split pending) or the Queue is empty with builds in Pending → one alert per idle spell through the console's alerts
  API (`notify.json` type `pipeline.idle`, pushed to AmberX), resolved when a build runs. `pipeline.launched`,
  `pipeline.ended` and `pipeline.split` are registered too (ended / failed push; started and split stay in the console).
- **Console**: the Build orchestrator page opens on a **Pipeline** tab: Pending / Queue / Building, the accounts
  (Fable, parallel, running, why one is out) with Toggle Fable / parallel / use, slots, the last tick, what the next
  tick starts and why the rest waits, the dispatcher log; Queue, Back to Pending, Split now. Routes
  `GET /pipeline`, `POST /pipeline/queue | unqueue | split | account | settings`; plugin commands for voice and MCP.

## Files

- `framework/core/build-pipeline.mjs` (+ `.d.mts`), `framework/plan/builds-store-core.mjs`, `builds-merge-core.mjs`,
  `framework/core/build-hook.mjs`, `feature-ledger.mjs`, `framework/cli/builds-reconcile.mjs`
- `apps/console-web/plugins/build-orchestrator/`: `pipeline-core.mjs` (pure), `pipeline.mjs` (CLI / dispatcher),
  `pipeline.test.mjs`, `notify.json`, `web/pipeline.tsx`, `web/ui.tsx`, `server/__init__.py`, `plugin.json`, `help.json`
- `deploy/install-console.sh` (cron `axf-pipeline`), `.github/workflows/android.yml` (the test)

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs` — 27 checks: the record and table, queue order,
  outcomes, accounts (plan / override / probe, workers vs the console's account, limits), candidates, the plan of a
  tick (slots, account caps, Fable routing, upgrade approval), session ends, split prompt / parser / rules, alerts,
  settings; then the CLI end to end on a scratch store with fake accounts, launcher and splitter: intake → Queue →
  launches on the right accounts → crash requeues and relaunches → clean finish → early stop back to Pending → idle
  alert once and resolved → split request → rules fallback.
- `check-builds-store` (40), `check-build-hook` (25), `check-feature-ledger` (66), `check-build-priority`,
  `check-builds-live` (62), orchestrator `test.mjs` (33), server `test.py` (21), notify-control `test.py` (132),
  check-theme, check-controls, check-toolbars, check-chrome-assets, check-help (260), console `tsc` — all green.

## Settings

`pipeline/settings.json` (pipeline-settings@1, `pipeline.mjs settings | set`): `parallelPerAccount` (default = Claude
setting `builds.maxParallel`), `fablePlans` (['max']), `useConsoleAccount` (true; only when no worker exists), `maxRuns`
(3), `idleAfterMin` (5), `probeDays` (7), `splitProvider` (claude | rules | off). `autoQueue` follows the Claude setting
*Launch builds without asking* (owner-only).

## Folded builds

- `idle-alert-phone-flag-when-nothing-is-building` — built here (the idle alert), marked complete.
- `orchestrator-start-a-build-through-the-api-mcp-and-cli` — the Queue is the start command (REST, MCP, CLI, voice);
  `queued` is accepted as a status; marked complete.

## Known gaps / decisions to check

1. The dispatcher is a host cron installed by `deploy/install-console.sh` on the next console deploy; until the PR
   lands and the installer re-runs, nothing is dispatched (this build's own session ran the old way).
2. Fable per account comes from the plan (`max`) until an override or a probe says otherwise; `pipeline.mjs probe
   <account>` costs one tiny call.
3. The split costs one Opus call per new build. Existing builds with hand-written steps are never re-split by themselves.
4. UI Review shots for the Pipeline tab are not in this PR (no console build in this session); the tab uses the
   console's own cards and controls only.
5. The unpushed `claude/pipeline-v2` worktree is untouched; delete it when Brett says so.
6. `_claude/builds/profiles/` came back from the hub through claude-sync in this session (the Nov 7 merge deleted it);
   left uncommitted here — the hub copy needs the same cleanup.
