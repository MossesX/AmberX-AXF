# Orchestrator self-check when stuck (Nov 9 2026)

Build: `orchestrator-self-check-when-stuck-verify-each-a` · branch `claude/orchestrator-self-check-when-stuck-verify-each-a`
(carries the first session's commit from `claude/orch-self-check-stuck`, PR #406, which it supersedes) · Opus.

Brett (Nov 9 2026): "The orchestrator is supposed to check all that every time it loads if things are stuck. If he has any
problems, he's supposed to check each account one by one. And look for stale jobs."

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

## Second session: when it runs

The first session ran the self-check only on stuck ticks and when the Pipeline tab opened. Now `P.checkDue()`
(pipeline-core, pure) decides on every tick, in this order:

1. asked for: console load, `POST /pipeline/selfcheck`, `pipeline.mjs selfcheck --request`, voice;
2. the dispatcher's first tick after it was down (no tick for 5 min or more, or never): deploy, reboot, stopped cron;
3. queued builds wait and this tick started nothing (stuck);
4. a routine sweep for stale claims, slots and builds every 30 min, even when nothing looks stuck.

The console asks on every Build orchestrator load, whichever tab opens (it moved from the Pipeline tab to the page).
AmberX still hears only when something was fixed or an account newly can't be used, so the sweep is quiet.

## How each surface reaches it

- REST: `POST /pipeline/selfcheck {reason}`; result in `GET /pipeline` → `state.selfCheck`, `accountsFrom`.
- MCP / voice / CLI runner: plugin command `pipeline-selfcheck` (registry-checked by `plugin-commands.mjs check`),
  read side `pipeline-status`.
- CLI: `pipeline.mjs selfcheck [--request] [--reason r] [--json]`.
- Deep link: `#/build-orchestrator` (Pipeline tab: Self-check card, "Check accounts now").

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

Second session: `pipeline.test.mjs` 40 checks (new: `checkDue` rules; e2e first tick after downtime runs it).
claude-workers 72, test.mjs 33, test.py 31, tsc clean; check-theme / controls / toolbars / chrome-assets pass.
`plugin-lifecycle.mjs check build-orchestrator` fails on stale references in `framework/cli/dispatch-gate.mjs`, which
are on main too and not touched here.

## Not done

- UI Review shots of the Self-check card: the live console runs main and there is no branch preview harness here, so
  desktop and phone shots wait for a session that can render the branch (or the deploy after it lands).
- Session heartbeats and killing hung sessions (`real-time-slot-tracking-stale-data-reaper` s2, s3).

## Live state when this ran

account-3 (Hulu, the only worker) 1/1, running this session. account-1 is a stopped worker, and mossesx-max- is the
console account, which only takes jobs when no worker exists. API keys take routed builds only (overflow is off).
hulu-api has no key saved. So the Queue waits on one slot. That is a setting (more workers, parallel per account, or
API overflow), not a fault.
