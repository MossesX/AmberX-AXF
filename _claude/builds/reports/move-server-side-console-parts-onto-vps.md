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
