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

### s14 (live): the blocker that held everything, found while checking the fix

Before (04:20–04:50 UTC): the cron logged `auto-land is off` every run. The merge queue's stack (#686, #688, #694) said
`running` for 27 minutes. In fact the queue rebuilt the stack **every round**: new merge commits at 04:42, 04:45, 04:48,
force-pushed to `queue/pr-*`, and android.yml (`cancel-in-progress` on `queue/**`) cancelled the running CI each time
(runs 43677947671, 43678167693 … all `cancelled`). Nothing could finish, so nothing landed after #683/#687 at 04:00.

Cause: #680 was first in Brett's manual order, and its queue commit can't be built (control inventory stale after
regenerating). `keepStack` compares the kept stack to the ready list position by position, so with #680 first it never
matched, and the stack was thrown away every round. The five console PRs (#633, #639, #637, #640, #643) wait behind it.

Fix (branch): `merge-queue-core.mjs stuckUnbuilt`: a PR whose queue commit failed at the same head, while main did not
move in code, waits outside the ready list with the reason until its head or main changes. Tested before/after.

Live mitigation (now, reversible): `merge-queue.mjs remove 680 --why "…"` (the queue's own command; `add 680` puts it
back). The cron line itself was right and needed no reinstall. The lander's new switch and serial mode reach /opt/axf
once this PR lands through the merge queue (never pushed to main by hand).

Dry run of this branch's runner against the live data, under the cron's lock:
`auto-lander on · serial · landing · landing #686 · ci-waiting`.

After (05:12 UTC, live, with #680 out of the queue): the stack holds between rounds again. The 04:54 run on #686 finished
(red, so #686 was kicked at 05:09 with a real verdict instead of being cancelled). #633 is under test (ETA ~11 min), and
#639, #637 and #640 are next, #643 at position 17.

## Root causes (summary)

1. **Unbuildable PR first in line churned the stack** (the one that stopped all landing): fixed in `merge-queue-core.mjs`
   `stuckUnbuilt`; mitigated live by removing #680 with its reason.
2. **Commands written during a round were lost** (the round wrote back the control file it read at its start): fixed
   with `mergeControl`.
3. **The queue ran on stale refs while `autoLand` was off** (`fetched: true` with nothing fetched): fixed in `runOnce`.
4. **No single switch, no serial path, no reason anywhere**: `autoLander.enabled` / `autoLander.mode` (serial default),
   a run record per run with the blocking reason, `auto-lander-status.json`.
5. **Stale "axf-lander inactive" warning**: it came from the unmerged server-lander PRs (#514/#539); replaced by the
   *Auto-lander cron* systems check on the real run log, with an Auto fix that reinstalls the cron line.
6. The five console PRs' first full CI on the queue was red on Nov 14 (help-coverage ratchet, engine fixtures). Their PR
   checks are light-only while the queue is on, so "green" there was not full CI.

## API map

| Surface | How |
|---|---|
| Tab | Build orchestrator → **Auto-lander** (TabGroup row, next to Rules); Settings → Plugins → Build orchestrator → Auto-lander |
| REST | `GET /api/plugins/build-orchestrator/auto-lander/status · line · runs?limit= · cron`; `POST …/enabled {enabled}`, `…/mode {mode}`, `…/line/move {pr, direction}`, `…/line/skip {pr, why, confirm}`, `…/line/unskip {pr}`, `…/line/land-now {pr, confirm}` (Brett's click) |
| Capability | `auto-lander@1` (push banner): status, line, runs, cron, set_enabled, set_mode, act |
| MCP | plugin commands `lander-status`, `lander-line`, `lander-runs`, `lander-cron`, `lander-enabled`, `lander-mode`, `lander-move`, `lander-skip`, `lander-unskip`, `lander-land-now` |
| CLI | `axf lander status · line · runs · on · off · mode <serial|queue> · move <pr> up|down · skip <pr> --why … --confirm · land-now <pr> --confirm`; also `axf build-orchestrator lander-…` |
| Voice | "turn on/off the auto lander", "set auto lander mode to serial", "what's landing", "why isn't it landing", "land 633 now" |
| Deep links | action `build-orchestrator.auto-lander[:on|off|mode:<m>|land-now:<pr>|skip:<pr>|move-up:<pr>]`, `build-orchestrator.tab:auto-lander`, `setting:autoLander.enabled`, `setting:autoLander.mode`, `row:<pr>/action:move-up|skip|land-now` |
| Systems check | *Auto-lander cron* (axf.syscheck.items@1:auto-lander), Auto fix → host doctor runs `auto-lander.mjs cron-heal` |

`control@1` is unchanged: its targets are tokens, AmberX entities and the planner.

## Open

- s15: UI Review shots. The three looks ship as settings assets (`build-orchestrator/assets/settings/auto-lander-*.json`).
  The choices file and shots plan are in this folder. Shots could not be captured from a scratch console in this session.
- #680 stays out of the queue until main is merged into it and its control inventory is regenerated; `merge-queue.mjs add 680` puts it back.
