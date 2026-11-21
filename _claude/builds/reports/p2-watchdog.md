# p2-watchdog: Pipeline 2.0 part 3 of 4, three-layer self-healing watchdog

Branch `claude/p2-watchdog`. Not merged: it lands with p2-status-core, p2-lander and p2-ui in one PR.

## What shipped

- `deploy/watchdog/core.mjs`: the pure decision table for the shared contract's statuses (forward-only guard, time
  budgets, issue finder, account picker, decisions, store patch).
- `deploy/watchdog/layer2.mjs`: layer 2, every minute. Probes tmux and the step logs, marks limited accounts out,
  kills hung sessions, applies every fix in one store write, nudges stuck transitions through the orchestrator tick,
  writes notes `by: watchdog`, an action log and a heartbeat. It pages Brett only on give-up.
- `deploy/watchdog/layer3.mjs`: layer 3 on a systemd timer, every 2 min (a different scheduler from what it checks).
  Heals the cron daemon, the schedules, a stale layer 2 and a stale tick. It alerts once, and only after three failed
  heals in a row. Layer 2 restarts layer 3's timer in turn.
- `deploy/watchdog/audits.mjs`: `builds-store.mjs verify`, `model-gate.mjs audit` and `build-origin.mjs missing`
  every 30 min (:17/:47). One at a time, nice 19 + ionice idle. Skipped while a heavy step runs or load > 0.7/core.
  Main checkout only. `handoff` repoints the four build rules on the live rules store.
- `deploy/watchdog/cron.mjs`: the one source for the orchestrator tick, layer 2, audits and layer 3 schedules. Every
  install removes `/etc/cron.d/axf-pipeline`, `axf-auto-land` and `axf-watchdog`.
- `deploy/install-console.sh`: the old pipeline / auto-land / recovery-watchdog cron lines are gone. Their files are
  deleted on every deploy and the deploy now calls `cron.mjs install` + `audits.mjs handoff`.
- `apps/console-web/plugins/build-orchestrator/install.mjs`: installs the 2.0 schedules instead of the old
  recovery-watchdog cron (that cron's slot filling ran the old pipeline tick).
- `_claude/builds/build-rules/seed.json`, `framework/cli/build-rules-migrate.mjs`: the four audit rules' `check` is now
  `watchdog:verify` / `watchdog:model-gate` / `watchdog:build-origin`. That is a checker id, so
  `build-rules-runner.mjs` skips it ("runs in its own place").
- CI: `node --test 'deploy/watchdog/*.test.mjs'` in the engine job.

## Checks run

- `node --test deploy/watchdog/*.test.mjs`: 15 passed (core table, layer 2 on a plain JSON store, layer 3 heal and
  alert once, schedules install/idempotent/retire).
- `gate/test/test.build-rules.mjs` 7 passed · `build-orchestrator/test.mjs` 35 passed · `test-watchdog.mjs` 15 passed ·
  `framework/deploy/test.sh` 58 passed · `check-model-policy.mjs` 18 passed · `bash -n deploy/install-console.sh` ok.
- Live, read-only: `layer3.mjs check` on the VPS reports the 2.0 schedules missing and layer 2 never run. That is
  expected: the deploy from main installs them. Nothing was installed on the box from this branch.
- Not run end to end against the real builds store: today's store normalizer (`builds-store-core.mjs`) still knows
  only the old statuses and drops the new fields (see contract item 1). It was tested on a plain JSON store
  (`AXF_WATCHDOG2_STORE`).

## Contract changes: flag for a Fable review

1. **Fields the watchdog reads and writes on builds and steps** (p2-status-core's store normalizer must keep them):
   `status`, `statusAt`, `statusBy`, `attempt`, `failedAt` (the status a `failed` record failed in), and
   `history: [{ status, at, by, attempt, why? }]`. On steps it also uses `account`, `slot`, `session`, `tried`
   (accounts this step already failed on), plus the optional `worktree`, `branch` and `log`. If status-core picks
   other names, change `sinceOf` / `stamp` in `core.mjs`; those are the only two places.
2. **Notes carry `by`**: notes are written as `{ text, at, by: 'watchdog' }`. Today's normalizer keeps only
   `{ text, at }`, so status-core must keep `by`. The note text also starts with "Watchdog:" so nothing is lost meanwhile.
3. **Retry semantics**: a failed build goes back into `failedAt` as attempt N+1, never to an earlier status. A
   failed step that died at `ready`, `sending` or `building` re-enters at **`ready`** with a pinned `account`. That is
   the relaunch path, so the orchestrator's account choice must honour a step's pinned `account` before `sending`.
   Watchdog writes are refused if they are not forward (`forwardOk`).
4. **Layer 1 command**: the watchdog nudges with `orchestrator.mjs tick --build <id>`, and the cron runs
   `orchestrator.mjs tick` every minute (`AXF_WATCHDOG2_TICK` overrides). p2-status-core must provide `tick` and
   accept `--build`. Until `orchestrator.mjs` has a `tick` command, layer 3 skips the tick check so it doesn't alert.
   The tick should write `{ at }` to `<pipeline dir>/orchestrator-tick.json` after each run. Layer 3 falls back to the
   mtime of `/var/log/axf-orchestrator-tick.log`.
5. **"Active build"** = status `pulling-main` through `merging-main` (or `failed` at one of those). Waiting statuses
   that are never called stuck while another build is active: build `split`, and step `ready` of a non-active build.
6. **Default time budgets** (minutes, `core.mjs`, overridable in settings). Build: pending 10, splitting 15, split 10,
   pulling-main 20, assigning-models 10, ready 5, sending 15, building 300, build-complete 10, merging-pr 20,
   pr-pulling-main 20, running-ci 60, merging-main 20. Step: pending 30, pulling-main 15, ready 60, sending 10,
   building 150 (and the log silent 20 min), completed 30. `maxAttempts` 5, two nudges 3 min apart before `failed`.
7. **Build rules**: `one-builds-store`, `model-upgrade-approval`, `fable-auto-upgrade` and `build-origin-verbatim` now
   name `watchdog:*` checkers instead of commands. The live store changes on the first deploy (`audits.mjs handoff`,
   with a reason on each edit).
8. **Account "usage left"**: no meter reports remaining usage today. The picker uses subscription logins that take jobs
   and are not limited, with the fewest running jobs first. API-key accounts are never picked (a run on an API key
   needs Brett's confirm).

## Judgement calls

- Layer 3 runs on the same VPS but on systemd, not cron. The plan's outside checker (axHub or another box) is left
  for the build box work.
- The old `recovery-watchdog.mjs` and `pipeline.mjs` code stays. Only their crons are retired, and those parts
  (p2-status-core / p2-lander) decide what to delete.
- The `install-console.sh` line that ran `watchdog.mjs install-cron` was already broken: the stale-row watchdog has no
  such command, so the old cron came from the plugin installer. It is removed.
- No build record called `p2-watchdog` was found in the store, so there were no steps to tick.
  `builds-live.mjs link p2-watchdog --branch claude/p2-watchdog` answered "No build \"p2-watchdog\"" after the push.
