# Fable rebuild 1/2: VPS host services

Build `fable-rebuild-1-2-vps-host-services-move`, branch `claude/fable-rebuild-1-2-vps-host-services-move`. A fresh
redo on main of `move-server-side-console-parts-onto-vps` (PR #828: never merged, 41 commits, 2,204 commits behind main
on Nov 21 2026). #828 is the reference; nothing is merged from its history.

## 1. What still runs inside the console container (s1)

Method: PR #828's file list and audit against `origin/main` at `976df7e93`; every `threading.Thread`, `Timer` and
`create_task` in `apps/console-web/server/` and `plugins/*/server/` (83 plugins, 12 more than the #828 audit, 3 gone);
the schedules `deploy/install-console.sh`, `deploy/watchdog/cron.mjs` and the plugin installers write; and what the VPS
runs today (`/etc/cron.d/axf-*`, `systemctl list-units 'axf*'`).

### 1a. PR #828 against main

- None of #828 is on main: no `deploy/host-services/`, no `framework/spec/HOST-SERVICES.md`, no `host-services`
  plugin, no `/run/axf-host`, no `axf-host` user on the VPS. Its 71 new files do not exist on main; its 25 edits to
  existing files are small (3 to 37 lines each).
- A merge clashes in 6 files: `maintenance/web/index.tsx`, `shipped-features/web/ui.tsx`, `server/main.py`,
  `framework/cli/builds-live.mjs`, `framework/spec/PORTING.md`, and `orchestrator-demo/web/DemoView.tsx` (the plugin was
  removed on main).
- What #828 assumed and main no longer has:
  - `deploy/auto-lander/` and `axf-auto-lander.service`: replaced by the lander, `deploy/lander/run.mjs`,
    `axf-lander.service` + timer (lander@1, Pipeline 2.0).
  - The crons `axf-pipeline`, `axf-auto-land`, `axf-watchdog`: retired. Now cron `axf-orchestrator-tick`, cron
    `axf-watchdog-l2`, `axf-watchdog-l3.service` + timer, cron `axf-watchdog-audits` (`deploy/watchdog/`).
  - The `push-banner` plugin (its `_auto_merge_loop` and `land.mjs`): removed.
  - The maintenance plugin's `engine/hostd.py` (from `maintenance-plugin-clear-docker-cache`, PR #779): closed without
    a merge, the build is archived. Main has `engine/maint.py` only.

### 1b. Already on the VPS host (skipped: nothing to move, adopted into the one list in s2)

| Part | Runs as | Owner |
|---|---|---|
| Lander (Gate & rules: build rules at the gate, one PR per build, merge) | `axf-lander.service` + timer, 1 min | gate |
| Orchestrator tick (dispatcher; runs the `before` / `after` build rules) | cron `axf-orchestrator-tick`, 1 min | build-orchestrator |
| Watchdog layer 2 | cron `axf-watchdog-l2`, 1 min | build-orchestrator |
| Watchdog layer 3 | `axf-watchdog-l3.service` + timer, 2 min | build-orchestrator |
| Store audits | cron `axf-watchdog-audits`, :17 and :47 | build-orchestrator |
| Stale-row watchdog | cron `axf-stale-watchdog`, 5 min | build-orchestrator |
| Reaper | cron `axf-reaper`, 2 min | console |
| Hard build limit | `axf-build-limit.service` + timer | console |
| Builds reconcile | cron `axf-builds-reconcile`, 10 min | build-orchestrator |
| Claude token save | cron `axf-claude-token-save`, 1 min | ai-keys |
| Console nightly | cron `axf-console-nightly` | console |
| Console doctor report | cron `axf-doctor`, 15 min | systems-check |
| Console self-update | cron `axf-console`, 5 min | console |
| Maintenance measuring | cron `axf-maintenance` (`engine/maint.py snapshot`) | maintenance |
| Data backup | cron `axf-data-backup` | data-store |
| Molly host bridge | `axf-molly-bridge.service` | molly-guide |

The two watchdogs are being reworked by `fable-rebuild-2-2-both-watchdogs-one` (running now). This build lists and
health-checks their schedules and does not touch their code or how they are started.

### 1c. Still in the container: moves to the host in this build

Each must keep working while the console is down, or touches Docker, host disk or git.

| # | Part | In the container today | Why it moves |
|---|---|---|---|
| 1 | Builds-live publisher | `flushLiveSoon` in `framework/cli/builds-live.mjs`: every store write from the console spawns the flush that commits to main | git writes to main; step ticks must reach main with the console down |
| 2 | Shipped features watcher | `_maybe_sync` thread in `plugins/shipped-features/server/__init__.py` (ledger SQLite from git + GitHub) | git + disk; the ledger falls behind when the console is down |
| 3 | axHub sync | the systems check's shared-data fix runs `persist.mjs push`; `claude-sync` is run by hand or by sessions | disk + hub; the checkout and the hub must agree with the console down |
| 4 | Agent job runner | `/jobs/run`, `/jobs/hire` in `plugins/agent-swarm/server/__init__.py` launch headless sessions from the container | CI-fix jobs must start with the console down; worktrees, git |
| 5 | Systems check host checks and Auto fixes | `hostfix.Jobs._run` threads (fixes through Mosses / `vps.run`), disk, Docker and git checks in `checks.py` | a dead console must still be seen and fixed; Docker, disk, git |
| 6 | Maintenance actions | `_loop` monitor in `plugins/maintenance/server/__init__.py` asks the host through `vps.run` for every measure and clean-up | disk and Docker; must work when the console or Docker is down |

### 1d. Still in the container: stays, with the reason

These loops only make sense inside the console process: they act on its in-memory state (alerts, control@1 passes,
plugin switches, its own environment) or serve a page that is open. With the console down there is nothing for them to
do, and a second copy on the host would do the work twice.

| Part | Loop | Why it stays | Host side that already covers the console-down case |
|---|---|---|---|
| github-app | `_keep_loop` | sets `GITHUB_TOKEN` in the console's own process environment | host callers mint their own through `framework/cli/github-token.mjs` |
| ai-keys | `_refresh_loop`, `ai-keys-vps` | renews pairs in the console's key store; takes in the host's renewals | cron `axf-claude-token-save` keeps the host logins fresh |
| claude-settings | `_clock` | renews or revokes a control@1 pass held by the console | none needed: the pass is the console's |
| claude-handoff | `_loop` | raises a console alert (a reminder) | none needed |
| activity | `activity-complete` | scans the console's own feed, pushes on finish | the lander and the watchdog push their own results |
| notify-control, `server/alerts.py` | rule and delivery threads | deliver alerts raised inside the console | host services raise through the host API; the systems check item per service pushes once |
| phone-connect | approvals watcher, WebSocket pump | serves a paired phone through the console | none needed |
| console-terminal | pty pumps, reaper, ticker | serves an open terminal tab; build sessions already live in the host's tmux (report `terminal-vps-host`) | host tmux |
| container-access | exec / restart jobs | UI-driven, through `axf-docker-proxy` (the socket is already isolated) | maintenance and systems-check host services |
| session-checkin | request-time `node checkin.mjs` | no loop; reads only | none needed |
| project-wizard | request-time repo / worktree creation | UI-driven, no loop | none needed |
| agent-manager | training loop, tool runs, memory reflect | agent runtime, lives with the chat it serves | agent jobs run through #4 |
| plugin-commands, console-commands, chat-viewer, output-recorder, snapshot-manager, ui-review, theme-manager, ai-assistant, claude-session, claude-accounts | registry sync, drains, timers, one-off jobs | console-only state or UI-driven work | none needed |
| `server/app_catalog.py`, `data_store.py`, `readcache.py`, `previews.py`, `main.py` | caches, shadow checker, pumps | console core | none needed |

New since the #828 audit: `axhub-account`, `axhub-approvals`, `axhub-apps`, `axhub-handoff`, `axhub-passes`,
`axhub-users`, `merge-queue-view`, `status-styles` (UI and request-time reads only) and `phone-connect` (above).
Gone: `push-banner`, `orchestrator-demo`, `audio-extract`.

### 1e. Move list

To the host in s2: the six parts in 1c, on one runner, one user and one sudo list, plus the host API they are reached
through. Adopted into the same list (manifest and health check only, started as they are today): the sixteen schedules
in 1b. Everything in 1d stays in the container.
