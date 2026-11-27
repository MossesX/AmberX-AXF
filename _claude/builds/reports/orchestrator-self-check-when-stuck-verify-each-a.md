# Orchestrator self-check when stuck (Nov 9 2026)

Build: `orchestrator-self-check-when-stuck-verify-each-a` · branch `claude/orch-self-check-stuck` · Opus.

## What was broken

1. **The console saw no accounts.** `GET /pipeline` runs `pipeline.mjs status` inside the `axf-console` container.
   That container has no `~/.claude-accounts`, and `workers.json` / `worker-state.json` live at a host path it doesn't
   mount. So `claude-workers status` returned zero rows there. The pipeline status then planned with an empty account
   list and said "no Claude account is signed in on the VPS". Meanwhile the host cron tick (`pipeline.mjs tick`, root)
   saw all six accounts. Reproduced with `docker exec -w /axf axf-console node …/pipeline.mjs accounts` → `no accounts`.
2. **Stale running counts.** `claude-workers.mjs liveSessions()` returned `null` ("can't tell") when tmux exited 1
   with `no server running` / `error connecting to …`, which is what tmux says when nothing runs. With `null`,
   every `session-login` in `events.jsonl` without a matching `session-end` counted as running. That gave the
   "Moses X 4/3, account-1 4/3 with zero tmux sessions" counts (build `fix-stale-running-counts-per-claude-account-not-cleared`).

## What changed

- `deploy/claude-workers.mjs`: `liveSessions()` treats "no server" as an empty set (`null` only when the tmux
  binary is missing). New `reap()` drops claims whose session is gone and limits past their end, under the state lock.
- `pipeline.mjs`:
  - `workerRows()` / `accountsRead()`: live claude-workers rows when this process sees the logins. Otherwise
    `accounts-host.json`, the snapshot every host tick (and every self-check) writes to the shared pipeline folder.
  - `status.accountsFrom` says which (`host | snapshot | none`), how old, and why when it's stale or missing.
  - `selfCheck()` (host): reap worker claims and expired limits, reap builds that hold nothing (`reapBuilds()`:
    running on an account with no session and no live agent slot past the 10 min grace → back to the Queue). Then it
    checks every account one by one (`checkAccount`: ready / busy / standby / blocked; signed in, key saved, key not
    rejected, limit, free slots), rewrites the snapshot, logs a `self-check` line, and keeps `state.selfCheck`.
  - It alerts AmberX (`pipeline:selfcheck`, notify type `pipeline.selfcheck`, push) when it fixed something or a
    blocked account shows up that wasn't blocked last time. The same problem doesn't repeat every minute.
  - Runs on every tick where queued builds wait and nothing launched, and on request: `selfcheck-request.json`,
    written by the console / API / voice, is picked up by the next tick.
  - CLI: `pipeline.mjs selfcheck [--request] [--reason r] [--json]`.
- Server: `POST /pipeline/selfcheck` (`{reason}`) + command `pipeline-selfcheck` in plugin.json (API / voice).
- UI (Pipeline tab): asks for a self-check on load. Adds a Self-check card (last result, fixes, accounts it can't
  use, one chip per account, "Check accounts now"), and shows when the account list is the host's snapshot.

## Choices

- An API key is checked locally (saved, and not rejected by its last run), not with a live call to Anthropic on
  every tick. The self-check runs every stuck minute, and the existing `limit --kind auth` path already catches a
  dead key on its first real run.
- On-demand checks from the console are a request the host tick runs (within a minute), not a host shell call.
  The container can't see the logins or tmux, and `axf.headless@1 vps_read` is meant for reads.
- Not in scope from `real-time-slot-tracking-stale-data-reaper`: session heartbeats and killing sessions. Covered
  from it: reconciling builds marked running with no live session or slot (s4, partly).

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 38 checks (new: per-account states and
  notify rule; e2e self-check + container snapshot + request picked up by the tick; e2e stale-build reaper).
- `node deploy/claude-workers.test.mjs`: 72 checks (new: reap, liveSessions with no tmux server).
- `node apps/console-web/plugins/build-orchestrator/test.mjs` 33, `test.py` 31; `tsc --noEmit` clean;
  check-theme / check-controls / check-toolbars / check-chrome-assets pass.

## Live state when this ran

account-3 (Hulu, the only worker) 1/1, running this session. account-1 is a stopped worker, and mossesx-max- is the
console account, which only takes jobs when no worker exists. API keys take routed builds only (overflow is off).
hulu-api has no key saved. So the Queue waits on one slot. That is a setting (more workers, parallel per account, or
API overflow), not a fault.
