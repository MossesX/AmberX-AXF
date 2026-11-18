# Move server-side console parts onto the VPS host

Build `move-server-side-console-parts-onto-vps` (Brett, Nov 17 2026: "So shouldn't we move everything to the VPS except
for the UI itself for the console? ... All right, do it.").

Goal: anything that must keep running while the `axf-console` container is down, or that touches Docker, disk or git,
runs on the host as a systemd service (code at `/opt/axf`, dedicated limited user, sudo whitelist only), and the console
keeps the UI and calls the host over a local socket/API with a clear "host service down" state.

## 1. Audit (s1)

Method: every folder in `apps/console-web/plugins/` (71 plugins), every module in `apps/console-web/server/`, the
console image (`apps/console-web/server/Dockerfile`) and the host cron lines in `deploy/install-console.sh`. For each:
background loop in the container (thread / task), Docker, disk or git use, subprocesses, outside calls.

Columns:

- **Down?** must it keep running when the console is down (yes = something stops happening, not only a page going dark).
- **D / Dk / G** touches Docker / host disk / git (the repo or GitHub branches).
- **Class**: `move` = move to the host, `stay` = stays in the container, `moving` = already moving in
  `server-auto-lander-fixes-lands` (orchestrator, lander, watchdog), `host` = already has a host part today (cron or
  host engine); the container keeps only its routes.

### 1a. Plugins with background work or host access

| Plugin | What runs server-side | Down? | D | Dk | G | Calls | Class |
|---|---|---|---|---|---|---|---|
| systems-check | `health.py` loop runs every health@1 check; `hostfix.py` / `mosses.py` Auto fix threads; `axf_data.py` restarts `axf-data` / runs backups | yes: a dead console must still be seen and fixed | yes (via axHub `vps.run`) | yes (disk check, prune fix) | yes (git checks) | axHub, GitHub, docker proxy, Coolify, VPS metadata | **move** (runner + Auto fix executor; check registry and UI stay) |
| maintenance | `_loop` monitor (swap, disk alerts, nightly run); measuring/removing in host `engine/maint.py` (cron from `deploy/host.sh`) | yes: disk-full alerts | yes | yes | yes (worktrees) | axHub `vps.run`, GitHub | **move** (monitor loop; engine is already `host`) — coordinate with `maintenance-plugin-clear-docker-cache` |
| push-banner | `_auto_merge_loop` (merges ready PRs every few min); `claudefix.py` fix chains; `land/land.mjs` already host cron `axf-auto-land` | yes: landing stops | yes (claudefix) | no | yes | GitHub API, claude headless | **moving** (lander + auto-merge replaced by auto-lander@1); `land.mjs` cron is `host` |
| build-orchestrator | routes shell out to `orchestrator.mjs`, `pipeline.mjs`; host cron `axf-pipeline` every minute; builds-live publisher | yes | yes (dispatch) | yes (worktrees) | yes | claude headless, GitHub | **moving** (tick on host in auto-lander@1; `axf-pipeline` cron is `host`) |
| gate | `lander.mjs`, routes run gate rules, git + GitHub (8 subprocess sites) | yes | no | no | yes | GitHub API | **moving** (auto-lander@1 is the gate on the host) |
| agent-swarm | job runner (`swarm.mjs`, `jobs.mjs`), Breakroom Run, crew-say threads; CI-fix jobs | yes: CI-fix jobs | no | yes (worktrees) | yes | claude headless | **move** (job runner) |
| shipped-features | watcher thread rebuilds the feature ledger (SQLite) from git + GitHub | yes (ledger falls behind) | no | yes (SQLite) | yes | GitHub API | **move** (watcher; reads stay) |
| session-checkin | git/Docker probes of running sessions, 4 subprocess sites | yes | yes | no | yes | GitHub | **move** |
| container-access | docker API through `axf-docker-proxy`; exec/restart jobs | no (UI-driven) | yes | no | no | docker proxy, Coolify | **move** (Docker actions; the proxy already isolates the socket) |
| console-terminal | tmux sessions, pty pumps, reaper, health ticker | yes: sessions die with the container today | yes (exec) | no | no | axHub, claude.ai | **move** (session host; xterm UI stays) |
| crew-live | git/GitHub reads, poll thread | no | no | no | yes | GitHub | stay (read-only view) |
| codebase-changes | git log/diff reads | no | no | no | yes | axHub | stay (read-only; moves with git reads later if the checkout leaves the container) |
| whats-shipped | git reads | no | no | no | yes | GitHub | stay (read-only) |
| feature-assist | one git read | no | no | no | yes | — | stay |
| claude-handoff | reminder loop; git + headless results | yes (reminders) | no | no | yes | axHub, claude.ai | **move** (reminder loop) |
| project-wizard | creates repos/worktrees on request | no | no | yes | yes | GitHub, claude.ai | **move** (git writes) |
| github-app | `_keep_loop` keeps the GitHub App token fresh | yes: every GitHub caller on the host needs it | no | no | no | GitHub | **move** (token keeper; host services are its main users) |
| ai-keys | `_refresh_loop` renews keys; `ai-keys-vps` thread writes host logins | yes | yes (2 sites) | yes (host key files) | no | Anthropic, axHub | **move** (refresh loop) |
| claude-settings | `_clock` tick (schedules, account switches) | yes | no | no | no | axHub | **move** |
| claude-accounts | shells out to account CLIs | no | no | yes (logins) | no | — | stay (UI-driven; CLI already on host) |
| claude-session | hub send threads, recordings | no | no | yes (recordings) | no | axHub | stay |
| claude-badge | usage reads | no | no | no | no | Anthropic | stay |
| activity | `complete.py` scan loop (pushes on finish), feed | yes: finish pushes | yes (2) | no | yes (1) | axHub push | **move** (completion scanner; feed UI stays) |
| notify-control | rule threads, settings refresh | yes (alerts route through it) | no | no | no | axHub | **move** (with the alert loop, see `alerts.py`) |
| plugin-commands | `_loop` syncs MCP command registry every few s | no | no | no | no | console | stay (describes the console's own routes) |
| output-recorder | `_loop` transcripts, whisper job | no | no | yes | no | — | stay |
| chat-viewer | `_timer` sync, TTS worker threads | no | yes (1) | yes | no | ElevenLabs, OpenAI, HF | stay |
| agent-manager | training loop, Vinny tool runs, memory reflect, containers.py, gittools.py | partly (training) | yes (2) | yes | yes (3) | Anthropic, GitHub, Firecrawl | stay for now; **move** `containers.py` + `gittools.py` tool backends behind the host API |
| ai-assistant | auto-title threads, one docker read | no | yes (1) | no | no | console | stay |
| molly-guide | rerecord send thread, one docker read | no | yes (1) | no | no | — | stay |
| ui-review | predicted-look jobs, conform, notify | no | no | yes (shots) | no | console | stay |
| snapshot-manager | hourly pruner | no | no | yes | no | — | stay |
| console-commands | drain threads, wake | no | no | no | no | console | stay |
| data-store | routes to `axf-data` | no | no | no | no | axf-data | stay (axf-data is its own container already) |
| agent-slots | reads the VPS-wide slot lock, docker ps | no | yes (2) | no | no | — | stay (CLI `agent-slots.mjs` is already `host`) |
| build-breaker, builds-page, fable-rebuilds, feature-matrix, glossary-index, demonstration-designer, plan-studio, plugins-menu, project-switcher, ref-links, skin-gallery, theme-manager, token-control, wake-listener, amberx-listeners | request-time `node` CLI calls, no loops | no | no | no | no | console, GitHub reads | stay |

### 1b. Plugins with no server work beyond settings / reads (stay)

alerts-bell, audio-extract, basic-filter, brand-library, build-profiles, changes-grid, context-menu-designer,
follow-amber, hub-sync (web only; the hub sync itself runs in `claude-sync`), main-build-status, mcp-client, md-studio,
notes-browser, notes-tasks, plugin-manager, plugin-switches, plugin-update, skin-editor, theme-editor, todo-manager,
voice-notes, agent-voice, approvals-banner. All **stay**.

### 1c. Console core (`apps/console-web/server/`)

| Module | Background work | Class |
|---|---|---|
| `alerts.py` | alert threads (raise, push to AmberX) | **move** the delivery loop with notify-control: an alert raised by a host service must reach the phone while the console is down |
| `app_catalog.py` | catalog refresh loop | stay |
| `data_store.py` | shadow checker thread | stay |
| `readcache.py` | background refresh | stay |
| `previews.py`, `wall.py`, `mcp_server.py`, `console_control*.py`, `projects.py`, `credentials.py` | request-time | stay (`mcp_server.py` gains proxies to host services) |
| `main.py` | `lifespan`, one run thread, a WebSocket pump | stay |

### 1d. Console image and host cron (today)

The image (`server/Dockerfile`) ships `git`, `tmux`, `node 22`, `openssh-client`; no cron runs inside it. Host cron
already in `deploy/install-console.sh` (all `host`, root): `axf-console` (self-update, 5 min), `axf-builds-reconcile`
(10 min), `axf-pipeline` (1 min), `axf-auto-land` (3 min), `axf-claude-token-save` (1 min), `axf-console-nightly`,
`axf-doctor` (15 min); plus `deploy/host.sh` → maintenance `engine/maint.py` and `deploy/axp-backup/systemd/*`.

### 1e. Move list (summary)

To the host (this build): systems-check runner + Auto fix executor, maintenance monitor, agent-swarm job runner,
shipped-features watcher, session-checkin probes, container-access Docker actions, console-terminal session host,
claude-handoff reminders, project-wizard git writes, github-app token keeper, ai-keys refresh, claude-settings clock,
activity completion scanner, notify-control + alert delivery, agent-manager container/git tool backends.

Already moving (reuse, don't duplicate): orchestrator tick, builds-live publisher, lander / auto-merge / gate,
stale-row watchdog (`orchestrator-stale-row-watchdog-vps`).

Everything else stays in the container.

## 2. What this build reuses, and where it overlaps (s2)

### server-auto-lander-fixes-lands (status built, PR #774, branch `claude/server-auto-lander-fixes-lands`)

What it put on the host:

- `deploy/systemd/axf-auto-lander.service` (oneshot, `@DIR@` = `/opt/axf`, log `/var/log/axf-auto-lander.log`,
  `Restart=on-failure`, `Nice=5`) + `axf-auto-lander.timer` (every 60 s, `OnBootSec=90s`, `Persistent=true`).
- `framework/deploy/axf-deploy.sh`: `axf_systemd_unit SRC DIR` (installs a unit with `@DIR@` replaced, honours
  `AXF_SYSTEMD_DIR`) and `axf_auto_lander_install DIR [--dry-run]` (daemon-reload + enable timer; dry run prints the
  systemctl calls and does one tick against a temp dir).
- `deploy/install-console.sh` calls the installer next to the host cron lines (tagged `# axf-plugin:gate`).
- Tick lock (its own lock file), per-attempt log in `_data/auto-lander/attempts/<build>.jsonl`, escalation to a
  health@1 item, status via `node deploy/auto-lander/auto-lander.mjs status`, REST in the gate plugin.

What it did **not** build: no dedicated user (the unit runs as root), no sudo whitelist, no local socket (the console
reads status from files and the CLI), no host-service-down state in the console beyond the escalation item, no
migration/rollback (cron lines `axf-pipeline` and `axf-auto-land` still run beside it).

Reuse here:

- Every new unit goes in `deploy/systemd/` with `@DIR@` and is installed through `axf_systemd_unit`; a generic
  `axf_host_services_install` replaces one-off installers and calls `axf_auto_lander_install` instead of copying it.
- Same pattern for each moved part: pure engine in `framework/core`, host runner in `deploy/<service>/`, oneshot+timer
  for ticks, `Type=simple` + `Restart=always` for long-runners (terminal host, alert delivery, Auto fix executor).
- Same state location (`_data/<service>/`), same health@1 escalation shape.

Overlap / what this build adds on top of it:

- The dedicated user (`axf-host`) and sudo whitelist apply to `axf-auto-lander.service` too: this build adds
  `User=`/`Group=` to that unit and the git/docker commands it needs to the whitelist. Its tick logic is not touched.
- The host-service socket/API (`/run/axf-host/api.sock`) exposes the auto-lander's status as one of its services, so
  the console's "host service down" state covers it; the gate REST routes keep working and read through it.
- Retiring the `axf-pipeline` and `axf-auto-land` cron lines in favour of units is part of this build's migration,
  with rollback re-adding the cron files. The push-banner `_auto_merge_loop` in the console is turned off once the
  auto-lander lands everything (auto-lander@1 already hands green PRs to the merge queue).
- `orchestrator-stale-row-watchdog-vps` (queued, on hold) becomes one more unit on the same installer; not built here.

### maintenance-plugin-clear-docker-cache (status running, one step, branch not pushed yet)

Its only step s1: "Move the Maintenance plugin's actions to run on the VPS host (systemd service or host runner), not
inside the console container, so it can restart Docker and keep working when the console or Docker is down. The
console UI just calls it." Its detail adds a Clear Docker cache action (`docker builder prune -af`, then
`systemctl restart docker` when cache shows as in use, wait for containers, prune again, report before/after disk),
behind a confirm, on UI/REST/MCP/CLI/voice, and in the disk systems-check Auto fix.

Overlap: its s1 is this build's maintenance row (1a). Split so nothing is built twice:

- That build owns the **Clear Docker cache action** (the engine call in `engine/maint.py`, the confirm, the routes,
  the disk Auto fix wiring).
- This build owns **where it runs**: the `axf-maintenance` host unit (monitor loop out of the console), the
  `axf-host` user and the sudo whitelist entries `docker builder prune -af`, `docker image prune -af …`,
  `systemctl restart docker`, and the socket route the console calls. If that build lands first with its own host
  runner, this build adopts it under the shared installer instead of writing a second one.
- Restarting Docker stops the console container, so the call must run on the host and report back through the host
  API, never through a console thread: that is the clearest case for this build's socket.

Clash notes were added to both builds (orchestrator notes).

## 3. The contract, the engine and the migration (s3-s5)

Spec `framework/spec/HOST-SERVICES.md`: host-service@1 manifests (`deploy/<service>/host-service.json`: id, unit, owning
plugin, sudo whitelist, health, actions, settings, `replaces`, `after`), the host API on `/run/axf-host/api.sock` +
loopback `127.0.0.1:7788` (routes in `REGISTRY.routes`), host-error@1 with `host_service_down`, host-service-state@1
(up / degraded / down / unknown with `since`), discovery (`AXF_HOST_API`, `AXF_HOST_API_FALLBACK`, `AXF_HOST_TOKEN`,
`GET /v1/services`), and the migration: per-service modes container / shadow / host, shadow drift
(host-shadow-drift@1), cut-over guards and tiers, rollback steps. Engine `framework/core/host-services.mjs`, schemas
`framework/schemas/host-service.json`, `schemas/json/host-service*.schema.json`, `schemas/json/host-error.schema.json`,
`framework/schemas/host-service-mode.json`; fixture `framework/spec/fixtures/host-services.json`; check
`framework/spec/check-host-services.mjs` (CI). Kotlin twin deferred (PORTING.md).

Decisions taken here (no one to ask): one gateway daemon (`host-api`) instead of a socket per service, so ticks (which
have no process to ask) get status, logs and run-now the same way as daemons; shadow means the host copy runs dry and is
compared, never two copies doing the work; no container → host shortcut; `host-api` has no mode; the terminal moves
last. The first manifests, the host API runner, the installer (`axf_host_services_install`), the `axf-host` user and the
console's REST / MCP / CLI / voice surface are the next phase.

Phase 3 changed one of these: manifests live in `deploy/host-services/services/<id>.json` (engine default
`manifestGlob`; `deploy/<dir>/host-service.json` is still read), and every daemon runs from one runner,
`deploy/host-services/axf-hostd.mjs`, with a worker module in `deploy/host-services/workers/<id>.mjs`.

## 4. What moved (phase 3, s6-s16)

| Service | Unit | Owning plugin | What runs on the host | Console copy (mode guard) | Sudo (all through `axf-task` or fixed lines) |
|---|---|---|---|---|---|
| host-api | `axf-host-api.service` | console | the gateway: list, state, health, unit verbs, actions, settings, logs, mode, shadow, rollback | — | `systemctl start/stop/restart <each named axf unit>`, one fixed `journalctl` line |
| builds-live | `axf-builds-live.service` | build-orchestrator | outbox publish every 20 s, pull main every 15 passes | `flushLiveSoon` stops spawning flushes in host mode (`framework/cli/host-mode.mjs`) | `axf-task builds-live-flush / -pull / -sync` |
| shipped-features | `axf-shipped-features.service` | shipped-features | ledger sync + ship landed manifests every 120 s | `_maybe_sync` returns in host mode (`server/host_mode.py`) | `axf-task shipped-sync / shipped-landed` |
| hub-sync | `axf-hub-sync.service` | hub-sync | `claude-sync sync` + `persist.mjs push` every 300 s | the systems check's shared-data fix asks the host in host mode | `axf-task hub-sync / hub-status / persist-push / persist-pull` |
| agent-swarm | `axf-agent-swarm.service` | agent-swarm | due jobs + sweep every 60 s; run-job / hire / event spooled and drained by root | `/jobs/run`, `/jobs/hire` send over the socket in host mode | `axf-task jobs-due / jobs-sweep / jobs-list / jobs-drain` |
| systems-check | `axf-systems-check.service` | systems-check | the host report (`console-doctor.sh --report`), disk, Docker space, checkout git state → `checks.json`; Auto fixes | `hostfix.Jobs` sends `HOST_FIXES` to the host in host mode | `axf-task doctor-report / git-status / console-install / claude-pick-install / keyfile-perms`, `docker system df` |
| maintenance | `axf-maintenance-actions.service` | maintenance | Clear Docker cache, Restart Docker, Measure now, Status through the plugin's own `engine/hostd.py` | (no container copy on main) | `axf-task maint-docker-cache / -norestart / maint-docker-restart / maint-status / maint-snapshot` |
| auto-lander | `axf-auto-lander.service` + timer | gate | adopted as is | cron `axf-auto-land` until host mode | none (own unit) |
| pipeline | `axf-pipeline.service` + timer (new unit files, same command) | build-orchestrator | adopted | cron `axf-pipeline` until host mode | none (own unit) |
| build-watchdog | `axf-build-watchdog.service` + timer | build-orchestrator | adopted | cron `axf-watchdog` until host mode | none (own unit) |
| stale-row-watchdog | `axf-stale-row-watchdog.service` + timer | build-orchestrator | adopted | cron `axf-stale-watchdog` until host mode | none (own unit) |

`deploy/host-services/bin/axf-task` is the one root entry: a task name is its only argument, so no sudoers line can
be widened. `gen-sudoers.mjs` writes `sudoers.d/axf-host` from the manifests only (`axf-*` expanded to named units,
`ALL`, shells, `env`, `tee`, free wildcards refused, `visudo -c`).

## 5. Runbook

Install (VPS, root; idempotent, safe to re-run):

    cd /opt/axf && bash deploy/install-host-services.sh --dry-run      # what it would do
    bash deploy/install-host-services.sh                               # user + group, env files, units, sudoers, start
    bash deploy/install-host-services.sh --only builds-live            # one service (+ host-api)
    bash deploy/install-console.sh                                     # once: mounts /run/axf-host into the console
                                                                       # (the auto-update does this on the next merge)
    node framework/cli/host-services.mjs list                          # every row should be up or "in console"

Everything starts in `container` mode: installed, running, idle. Nothing has moved until the migration says so.

Migrate one service (container → shadow → host), verify each step:

    node deploy/host-services/migrate.mjs status
    node deploy/host-services/migrate.mjs shadow builds-live           # both run, the host dry-runs
    node deploy/host-services/migrate.mjs verify builds-live
    node deploy/host-services/migrate.mjs host builds-live             # after ≥ 30 min quiet shadow, ≥ 3 clean runs
    node deploy/host-services/migrate.mjs next --apply                 # the next step for everything, in tier order

Roll back (always allowed; mode flips first, unit stops, cron lines come back, verify):

    node deploy/host-services/migrate.mjs rollback builds-live          # or: axf host rollback builds-live --yes
    node deploy/host-services/migrate.mjs rollback builds-live --to shadow

Remove: `bash deploy/install-host-services.sh --uninstall [--only a,b]` (data in `_data/host-services` is kept).
Drills: `bash deploy/dryrun/host-services.sh`, `bash deploy/dryrun/host-services-rollback.sh`.

## 6. How each feature is reached

| Feature | UI | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| list / status | Settings → Plugins → Host services (deep link `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=host-services`, `settings.open:host-services`); Systems check panel | `GET /api/host-services`, `GET /api/host-services/{id}` | `host_services_list`, `host_services_get` | `axf host list`, `axf host status <id>` | `host.status[:id]` |
| restart / start / stop / run | row buttons (`host:<id>/unit:<verb>`) | `POST /api/host-services/{id}/unit/{verb}` (stop, restart: confirm) | `host_services_action {do}` | `axf host restart <id> --yes` | `host.restart:<id>` |
| service actions | row detail (`host:<id>/action:<a>`) | `POST /api/host-services/{id}/actions/{a}` | `host_services_action {do: run-action}` | `axf host action <id> <a>` | through console control |
| mode | row detail "Where it runs" (`host:<id>/mode`) | `PUT /api/host-services/{id}/mode` (back: confirm) | `host_services_set_mode`, `host_services_mode` | `axf host mode <id> <mode>`; `migrate.mjs` | `host.mode:<id>:<mode>` |
| rollback | Roll back (`host:<id>/rollback`) | `POST /api/host-services/{id}/rollback` (confirm) | `host_services_rollback` | `axf host rollback <id> --yes` | `host.rollback:<id>` |
| logs | Logs (`host:<id>/logs`) | `GET /api/host-services/{id}/logs` | `host_services_logs` | `axf host logs <id>` | — (read in the view) |
| settings | (row detail lists them) | `GET/PUT /api/host-services/{id}/settings` | `host_services_settings`, `host_services_settings_set` | `axf host settings <id> k=v` | console control |
| down state | HostServiceGate on Breakroom, Shipped features, Maintenance; systems-check items `host-api`, `host-service:<id>` with Auto fix | 503 `host_service_down` frame | tool error `host_service_down: …` | exit 3 | "The host API is down. …" |

## 7. UI Review (s26)

Item `r-20261118-38820c16` (pending) (group "move-server-side-console-parts-onto-vps"), choice set `toolbar-host-services` (ui-choices@1,
type `toolbar`, owner `host-services`): three page-toolbar options for the Host services view, each an asset in
`apps/console-web/plugins/host-services/assets/toolbar/` (shipped picked or not):

| Option | Asset | Look |
|---|---|---|
| Icons + labels, overflow (default) | `host-services` (+ `toolbar-host-services-labels`) | List / Fix groups, icon + label, folds into More |
| Dense icons | `toolbar-host-services-dense` | icons only, labels in tooltips: most room on a phone |
| Flat row | `toolbar-host-services-flat` | one row, Restart down services first, no overflow |

Each option is shot desktop (1440) and phone (412, S26 Ultra width) in three scenes by
`apps/console-web/scripts/host-services-shots.mjs` against `vite preview` with a fixed fixture: **list** (every row
kind: up, degraded, down, in console, a tick; one row opened), **down** (the host API unreachable: the "Host service
down" note, every row unknown) and **gate** (the Breakroom with agent-swarm down: the shared HostServiceGate note).
The script picks its own free port: other checkouts leave `vite preview` servers on the usual ports, and the first
captures of this step pictured another branch's console.

Fixed while shooting: rows drifted right with the service name (the grid's `fr` tracks sized each row from its own
content), now fixed widths in `--fx-font-size` units with a phone column set (service, status, mode, actions); and the
Breakroom and Shipped features returned their empty state before HostServiceGate rendered, so a page whose own data
failed never said the host side was down.

## 8. Known gaps

- **Shadow comparison from the console side**: the host counts its own clean dry-runs and compares any run the console
  reports (`POST /v1/services/{id}/shadow`, `host_services.report_shadow`), but the console loops do not report yet,
  so drift is only seen when something posts a run. Cut-over still needs the shadow time and the clean host runs.
- **Node 22 on the host**: the ledger (shipped-features) uses `node:sqlite`; the VPS shell runs Node 20 today. The
  service reports itself degraded with the fix (install Node 22) until then; the installer warns.
- **Maintenance** calls `engine/hostd.py` from `maintenance-plugin-clear-docker-cache`, which is not on main yet; until
  it lands those actions answer "not in this checkout yet" (exit 69). Note left on that build.
- **Adopted ticks** (auto-lander, pipeline, watchdogs) keep running as root under their own unit files; their manifests
  declare no sudo and are listed, health-checked and controlled through the host API only.
- **Not moved in this build** (audit 1e, no step here): session-checkin, container-access, console-terminal,
  claude-handoff, project-wizard, github-app, ai-keys, claude-settings, activity, notify-control + alert delivery,
  agent-manager tool backends. Each is a manifest + worker on the same runner; follow-up build.
- Kotlin twin of the engine: deferred (PORTING.md).
- **Look, open in review**: the toolbar's count badges sit over the end of the Refresh / Restart down services labels
  (the shared page-toolbar badge placement, seen in every option), and on desktop the grid runs about 50 px past the
  panel. Left for the pick in item `r-20261118-38820c16`.
- **Deep link in list layout**: `open view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=host-services`
  answers ok but the settings page in list layout (the console's default) stays on its section list; the shots script
  presses Plugins → Host services instead. The console-control settings opener needs to follow sub-tabs in list layout
  (shared, not this plugin's code); `settings.open:host-services` from the Gate button works.
