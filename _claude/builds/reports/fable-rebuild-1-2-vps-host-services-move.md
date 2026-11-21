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
| Build watchdog (stuck sessions, stuck statuses, stale rows; it replaced the stale-row cron on Nov 21) | cron `axf-build-watchdog`, 1 min | build-orchestrator |
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

The two watchdogs were reworked by `fable-rebuild-2-2-both-watchdogs-one` (PR #883, merged while this build was in CI):
the stale-row cron became the one `axf-build-watchdog` cron, which is what is adopted here. This build lists and
health-checks the watchdog schedules and does not touch their code or how they are started.

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

## 2. What was built (s2)

The host-service@1 contract, runner, installer and console surface from #828, brought onto current main in one commit
and changed where main had moved on.

| Part | Where |
|---|---|
| Contract and engine | `framework/spec/HOST-SERVICES.md`, `framework/core/host-services.mjs`, schemas `framework/schemas/host-service*.json` + `schemas/json/host-*.schema.json`, fixture `framework/spec/fixtures/host-services.json`, check `framework/spec/check-host-services.mjs` |
| Runner | `deploy/host-services/axf-hostd.mjs` (one runner; `host-api` is the gateway on `/run/axf-host/api.sock` and `127.0.0.1:7788`) |
| Least privilege | system user `axf-host`; `deploy/host-services/sudoers.d/axf-host` generated by `gen-sudoers.mjs` from the manifests; root work only through `bin/axf-task <fixed task>`; units from `axf-host@.service` |
| Installer | `deploy/install-host-services.sh` (`--dry-run`, `--only`, `--uninstall`); `deploy/install-console.sh` now runs it whenever the host-service files changed (stamp `/etc/axf-host/installed.rev`) and mounts the socket |
| Migration | `deploy/host-services/migrate.mjs`: container → shadow → host per service, verify, rollback; drills in `deploy/dryrun/` |
| Console | client `apps/console-web/server/host_services.py`, REST `host_services_routes.py`, plugin `plugins/host-services`, `src/hostServices.tsx` (HostServiceGate), health items in `plugins/systems-check/server/host_health.py`, CLI `framework/cli/host-services.mjs` |

### Moved (each a unit with a health check; all start in `container` mode)

| Service | Unit | Owning plugin | On the host | Console copy steps aside |
|---|---|---|---|---|
| host-api | `axf-host-api.service` | console | the gateway: list, state, health, unit verbs, actions, settings, logs, mode, rollback | (none) |
| builds-live | `axf-builds-live.service` | build-orchestrator | publishes the outbox to main, pulls main back | `flushLiveSoon` in host mode |
| shipped-features | `axf-shipped-features.service` | shipped-features | ledger sync, ships landed manifests | `_maybe_sync` in host mode |
| hub-sync | `axf-hub-sync.service` | hub-sync | `claude-sync sync` + `persist.mjs push` | the shared-data fix asks the host |
| agent-swarm | `axf-agent-swarm.service` | agent-swarm | due jobs, sweep, run-job / hire / event | `/jobs/run`, `/jobs/hire` send over the socket |
| systems-check | `axf-systems-check.service` | systems-check | doctor report, disk, Docker space, git state, Auto fixes | `hostfix.Jobs` sends its fixes to the host |
| maintenance | `axf-maintenance-actions.service` | maintenance | Measure now, Clear Docker cache, Restart Docker, Status | (no container copy) |

### Adopted (already on the host; listed and health-checked, never installed, stopped or migrated here)

| Service | Started by | Health |
|---|---|---|
| lander | `axf-lander.service` + timer | timer active, last run from systemd, stale after 15 min |
| watchdog-l3 | `axf-watchdog-l3.service` + timer | same |
| build-limit | `axf-build-limit.service` + timer | same, stale after 10 min |
| orchestrator-tick | cron `axf-orchestrator-tick` | cron file there, log written in the last 15 min |
| watchdog-l2 | cron `axf-watchdog-l2` | same |
| watchdog-audits | cron `axf-watchdog-audits` | log written in the last 2 h |
| build-watchdog | cron `axf-build-watchdog` | log written in the last 15 min |
| reaper | cron `axf-reaper` | log written in the last 15 min |
| builds-reconcile | cron `axf-builds-reconcile` | log written in the last hour |
| claude-token-save, console-nightly, console-update | cron | cron file there (their logs are only written when something happens) |

Not adopted: cron `axf-maintenance` and cron `axf-doctor` (the maintenance and systems-check services replace them at
cut-over), `axf-data-backup` (runs inside the `axf-data` container), `axf-molly-bridge.service` (a daemon with no
host-service socket; it has its own check).

### Changed against #828

- **Adopted schedules** are new in the contract: `adopted: true`, `cron: <file>`, `health.freshness`. #828 registered
  the auto-lander, the pipeline tick and two watchdogs as ticks to be migrated from cron to its own unit files; all
  four are gone on main. Its unit files `axf-pipeline.*`, `axf-build-watchdog.*`, `axf-stale-row-watchdog.*` are not
  shipped: installing them would have brought retired ticks back.
- **Maintenance**: #828 called `engine/hostd.py` from a build that never merged, so Clear Docker cache answered "not in
  this checkout yet". The Docker work is now `deploy/host-services/tasks/maint-docker.mjs` (prune build cache and
  dangling images; when the cache is stuck, restart Docker, wait for every container, prune again; before/after disk).
- **Cut-over tiers** list only services that exist (#828 named ten that were never built).
- **Rollback and mode** are refused for adopted schedules; the sudoers file has no `stop` line for an adopted unit.
- **Install** happens with the console installer; #828 left it as a manual step.
- Conflicts with main resolved in `maintenance/web/index.tsx`, `shipped-features/web/ui.tsx`, `server/main.py`,
  `framework/cli/builds-live.mjs` (the host-mode guard sits after main's new `outboxDue` branch), `PORTING.md`.

## 3. The view and the down state (s3)

Settings → Plugins → Host services (and the Systems check panel):

- Two groups: **Moved from the console** and **Already on the host** (adopted).
- A **Host service down** note names every service that should be running on the host and is not, why and for how
  long. Container mode is not down. When the host API itself cannot be reached the note says so and every row reads
  unknown.
- An adopted unit has Restart and Run now, no Stop, no mode control. A cron schedule has no buttons; its row says
  which cron file starts it.
- Moved plugins' own screens (Breakroom, Shipped features, Maintenance) show the same state through HostServiceGate.
- Fixed from the #828 review notes: the grid no longer runs past the panel on desktop (narrower columns).

UI Review item `r-20261118-38820c16` was removed by the watchdog on Nov 19 when the old build was cancelled. Its three
page-toolbar options ship as assets in `apps/console-web/plugins/host-services/assets/toolbar/` (default: icons and
labels with overflow). New shots are in UI Review → Screenshots, group "Fable rebuild 1/2: VPS host services".

## 4. How each feature is reached

| Feature | UI | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| list / status (moved and adopted) | Settings → Plugins → Host services (`view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=host-services`, `settings.open:host-services`); Systems check panel | `GET /api/host-services`, `GET /api/host-services/{id}` | `host_services_list`, `host_services_get` | `axf host list`, `axf host status <id>` | `host.status[:id]` |
| restart / start / stop / run | row buttons (`host:<id>/unit:<verb>`) | `POST /api/host-services/{id}/unit/{verb}` (stop, restart: confirm) | `host_services_action {do}` | `axf host restart <id> --yes` | `host.restart:<id>` |
| service actions (e.g. Clear Docker cache) | row detail (`host:<id>/action:<a>`) | `POST /api/host-services/{id}/actions/{a}` | `host_services_action {do: run-action}` | `axf host action <id> <a>` | through console control |
| mode | row detail "Where it runs" (`host:<id>/mode`) | `PUT /api/host-services/{id}/mode` | `host_services_set_mode`, `host_services_mode` | `axf host mode <id> <mode>`; `migrate.mjs` | `host.mode:<id>:<mode>` |
| rollback | Roll back (`host:<id>/rollback`) | `POST /api/host-services/{id}/rollback` | `host_services_rollback` | `axf host rollback <id> --yes` | `host.rollback:<id>` |
| logs | Logs (`host:<id>/logs`) | `GET /api/host-services/{id}/logs` | `host_services_logs` | `axf host logs <id>` | read in the view |
| settings | row detail | `GET/PUT /api/host-services/{id}/settings` | `host_services_settings`, `host_services_settings_set` | `axf host settings <id> k=v` | console control |
| down state | the Host service down note (`host-services.down`), HostServiceGate; systems-check items `host-api`, `host-service:<id>` with Auto fix | 503 `host_service_down` | tool error `host_service_down: …` | exit 3 | "The host API is down. …" |

Adopted schedules answer the same list, status and logs calls. Unit verbs on a cron schedule, Stop on an adopted unit,
and mode or rollback on any adopted schedule answer `unknown_action` with the reason, on every surface.

## 5. Runbook

    bash deploy/install-host-services.sh --dry-run        # what it would do
    bash deploy/install-console.sh                        # installs the host services when their files changed, mounts the socket
    node framework/cli/host-services.mjs list             # every row: up, or "in console" (container mode)
    node deploy/host-services/migrate.mjs status
    node deploy/host-services/migrate.mjs shadow builds-live   # both run, the host dry-runs
    node deploy/host-services/migrate.mjs host builds-live     # after 30 min quiet shadow and 3 clean runs
    node deploy/host-services/migrate.mjs rollback builds-live # always allowed

## 6. Tests and checks

| Check | Result |
|---|---|
| `framework/spec/check-host-services.mjs` | 9 checks, 19 manifests (was 8 checks, 11 manifests in #828) |
| `deploy/host-services/test-hostd.mjs` | 31 checks (was 25): adds adopted cron down / up, no unit verbs, logs from the file, no mode, no rollback |
| `deploy/host-services/test-sudoers.mjs` | 6 checks |
| `deploy/host-services/axf-hostd.mjs --check` | every manifest loads, every action has a worker function |
| `deploy/dryrun/host-services.sh`, `host-services-rollback.sh` | 7 + 7 checks |
| `server/tests/test_host_services.py`, `plugins/host-services/test.py` | 5 passed, routes test passed |
| systems-check and maintenance self-tests | 231 and 96 checks |
| check-theme, check-controls, check-toolbars, check-console-control, check-builds-live, check-done-means-merged | pass |
| plugin lifecycle: host-services, maintenance, hub-sync, shipped-features, agent-swarm | clean |

## 7. Known gaps

- **Nothing has cut over.** Every moved service installs in `container` mode: the unit runs idle and the console keeps
  doing the work until `migrate.mjs` moves it (shadow first). That is the design, and it is also what is left to do.
- **Shadow comparison from the console side**: the host counts its own clean dry-runs; the console loops do not report
  theirs yet, so drift is only seen when something posts a run.
- **Node 22 on the host**: the shipped-features ledger uses `node:sqlite`; the VPS shell has Node 20. The service
  reports degraded with the reason until Node 22 is there, and its self-test cannot run on the host shell (CI has 22).
- **Cron schedules keep no result**: a run that fails but still writes its log reads as up. The owner's own health
  check covers what the run did.
- **Stays in the console** (§ 1d): the github-app keeper, the ai-keys refresh, the claude-settings clock, alert
  delivery, the terminal pumps, phone-connect. They act on the console's in-memory state; moving one means giving it
  a host-side store first.
- **Deep link in list layout**: opening the sub-tab address answers ok but the settings page in list layout stays on
  its section list (shared console-control settings opener, not this plugin's code).
- Kotlin twin of the engine: deferred (PORTING.md).
