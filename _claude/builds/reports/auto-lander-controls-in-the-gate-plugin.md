# Auto-lander controls in the gate plugin

Build `auto-lander-controls-in-the-gate-plugin`, Nov 15 2026.

Brett (verbatim): "we need a control for the auto lander, put it in the plugin we built today where we put the rules for the gate, there were like three tabs"

## Notes

### s1: which plugin holds the gate rules

- No standalone "gate" plugin exists on main or on any branch. The server gate work Brett means is in
  **build-orchestrator**. PR #610 (`claude/server-gate-one-session-per-build-no`, open) adds the Server gate log page
  (`web/gate-log.tsx`, filterable by gate in a TabGroup), its banner widget (`web/gate-banner.tsx`) and the
  `gate-log` / `gate-banner` routes in `server/__init__.py`. The gate rules engine itself is `framework/cli/server-gate.mjs`
  on that branch. The main-gate rules (PR #508, `framework/cli/main-gate.mjs`) were closed without merging.
  owner-recognized-everywhere-veto (PR #601) is in claude-settings (approvals policy), not the gate.
- Decision: the Auto-lander tab goes in **build-orchestrator** (Settings → Plugins → Build orchestrator, plus its own
  view), in new files only, so it does not conflict with #610 when that lands. The lander core stays in push-banner and
  build-orchestrator reaches it only through the `auto-lander@1` capability service.
- Where the lander reads its switches (push-banner data dir `/opt/axf/.axf-console/plugins/push-banner/config.json`):
  - `land.mjs` `readConfig()` reads `autoLand` (builds round) and `landWaitUi`; `round()` returns at once with
    `on: false` when `autoLand` is not `true`.
  - `merge-queue.mjs` `readQueueConfig()` reads `mergeQueue`, `queueMode` (batch | stack), `queueDepth`, `batchSize`.
  - `autoMerge` (the console's own one-at-a-time merge, push-banner `server/__init__.py`) is false.
- Cron: `/etc/cron.d/axf-auto-land`, every 3 minutes as root:
  `cd /opt/axf && AXF_LAND_REPO=/opt/axf flock -n /run/axf-auto-land.lock timeout 900 node …/land.mjs run >> /var/log/axf-auto-land.log`.

### s2: why the auto-lander "lands nothing"

Evidence (Nov 15 04:20 UTC):

1. **The builds round has been off since Nov 4.** `config.json` has `autoLand: false`. Every cron run logs
   `auto-land is off (Settings → Plugins → Push banner → Auto-land)`, and a dry run under the cron's env says the same. So
   nothing merges main into finished branches or starts full CI on their heads, and the log reads as if the whole lander
   were dead.
2. **The merge queue does run, but slowly, and it kicks more than it lands.** `mergeQueue: true`, `queueMode: stack`,
   `queueDepth: 3`. Since 00:00 UTC it merged 2 PRs (#683, #687) and kicked 7 (#662, #655, #646, #598, #601, #589, #681).
   30 merges in the log in total.
3. **The console PRs are not really green.** #633/#637/#639/#640/#643 show green because PRs run only the light checks
   while the queue is on (2 success, 5 skipped, mergeable UNKNOWN). Their first full CI is on the queue commit. On Nov 14
   13:33–14:18 all five were kicked for real failures there. Same steps every time: `help-coverage.mjs --check` ("help
   coverage fell to 99.9%, ratchet 100%") and "Alerts + MCP client + axf_server: engines match their fixtures". They
   have since pushed new heads and are back in line at queue positions 6, 7, 9, 10 and 20 (ETA 28–98 min). Ahead of them,
   #686/#688/#694 are on the stack and #680 can't build its queue commit (stale control inventory).
4. **There is no serial lander on main.** The one-at-a-time landing line (`framework/core/landing-line.mjs`, Brett Nov 14:
   "start landing them one at a time") is on main, but its runner (`land/lander.mjs`, `axf-lander.service`, PRs #514/#539)
   never landed. That is why the "axf-lander inactive" warning points at a systemd unit that doesn't exist.
   `landing-line.json` and `land-runs.jsonl` in the data dir are stale (last written Nov 15 01:04 by a branch checkout).
5. Not the cause: the lock (`/run/axf-auto-land.lock`, flock, free), the token broker (`github-token.mjs token`
   works, 2–9 billed calls a run), cron env and user (root, `/opt/axf`), main CI (green at e3557422).

Root cause: the run has no single switch and no serial path. `autoLand` off silences the builds round, the stack queue
is the only lander, and nobody can see why a PR isn't landing. The fix (s3/s5) is one `autoLander.enabled` switch that
the cron reads, a `serial` mode (one PR at a time on the real main, the default) next to the merge queue, and a status
record that names the blocking reason.
