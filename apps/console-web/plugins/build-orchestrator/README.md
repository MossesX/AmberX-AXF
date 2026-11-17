# Build orchestrator

Splits every build into small steps (10 min or less, pinned to Fable or Opus) and runs the build pipeline:
Pending → Queue → Building. The store is `_claude/builds/store.json`; the rules for sessions are in
`_claude/builds/README.md`.

- `orchestrator.mjs`: steps, phases, briefs, notes, approvals (`next | brief | act`).
- `pipeline.mjs`: the dispatcher on the VPS host (cron `axf-pipeline`, every minute, `flock /run/axf-pipeline.lock`).
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

## Tests

`node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs` (pure rules and the CLI end to end on a scratch
store with a fake launcher), `node framework/spec/check-build-pipeline.mjs`, `node framework/spec/check-builds-store.mjs`.
