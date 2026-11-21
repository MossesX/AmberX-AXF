# HOST-SERVICES — host-service@1, the console's server side on the VPS host

Status: contract since Nov 17 2026 (designed in `move-server-side-console-parts-onto-vps`, PR #828, never merged; rebuilt on
main Nov 21 2026 by `fable-rebuild-1-2-vps-host-services-move`, which added adopted schedules; Brett: "So shouldn't we
move everything to the VPS except for the UI itself for the console? ... All right, do it."). Reference engine:
`framework/core/host-services.mjs` (pure). Registry snapshot: `framework/schemas/host-service.json`. JSON Schemas:
`schemas/json/host-service.schema.json`, `host-service-state.schema.json`, `host-error.schema.json`; the mode file
`framework/schemas/host-service-mode.json` (→ Migration). Fixture: `framework/spec/fixtures/host-services.json`
(`spec/check-host-services.mjs`). Audit: `_claude/builds/reports/fable-rebuild-1-2-vps-host-services-move.md`.
Kotlin twin deferred (PORTING.md).

## Why

Anything that must keep running while the `axf-console` container is down, or that touches Docker, host disk or git,
runs on the host as a systemd unit. The console keeps the UI and every API surface (REST, MCP, CLI, voice) and calls the
host over a local socket. A host service that is not answering is a state the UI shows (`host_service_down`), never a
stack trace or a spinner. The audit (report § 1) lists what moves; this document says how every moved part looks the
same to the console.

Not an asset type: a host service has no look. Its UI (the Host services sub-tab of Settings → Plugins, and each owning
plugin's own screens) is built from framework controls on the console's assets like any other screen.

## Vocabulary

| Word | Meaning |
| --- | --- |
| **service** | one moved part: a manifest (`host-service@1`), a systemd unit, a runner in `deploy/<service>/`, state in `_data/host-services/<id>/` |
| **tick** | a `Type=oneshot` unit started by a timer (`axf-<id>.timer`); the runner holds its own lock, so overlapping starts do nothing |
| **daemon** | a `Type=simple`, `Restart=always` unit that serves a unix socket `/run/axf-host/<id>.sock` |
| **host API** | the one daemon (`host-api`, unit `axf-host-api.service`) the console talks to; it knows every manifest, asks systemd about units, forwards to daemons, starts ticks |
| **owning plugin** | the console plugin whose server side the service replaces; its Plugin Manager entry lists the service |
| **mode** | where a service runs today: `container`, `shadow`, `host` (→ Migration) |

## The manifest (host-service@1)

One file per service: `deploy/host-services/services/<id>.json` (older parts may keep `deploy/<dir>/host-service.json`;
both are read). The host API reads every manifest at
start and on `SIGHUP`; `node framework/spec/check-host-services.mjs` validates every manifest in the repo in CI.

```jsonc
{
  "$axf": "host-service@1",
  "id": "maintenance",                           // ^[a-z0-9][a-z0-9-]{0,40}$; everything else derives from it
  "title": "Maintenance monitor",
  "description": "Disk, swap and nightly maintenance; the Clear Docker cache action.",
  "kind": "daemon",                              // tick | daemon
  "unit": "axf-maintenance.service",             // axf-<id>.service unless stated; a tick also names its "timer" (or "cron": → Adopted schedules)
  "plugin": "maintenance",                       // owning console plugin folder, or "console" for core parts
  "runner": "deploy/maintenance/host.mjs",       // repo-relative; the unit's ExecStart is `node @DIR@/<runner>`
  "user": "axf-host",                            // default; the installer creates it (no shell, no password)
  "sudo": [                                      // the whole whitelist; the installer writes /etc/sudoers.d/axf-maintenance
    { "cmd": "/usr/bin/docker builder prune -af", "why": "Clear Docker cache" },
    { "cmd": "/usr/bin/systemctl restart docker", "why": "Clear Docker cache when the cache shows as in use" }
  ],
  "socket": "/run/axf-host/maintenance.sock",   // daemon default; ticks have none
  "health": { "path": "/health", "intervalSec": 30, "timeoutMs": 5000, "staleSec": 180 },
  "actions": [
    { "id": "clear-docker-cache", "title": "Clear Docker cache", "confirm": true, "timeoutMs": 600000,
      "args": { "restartDocker": { "type": "boolean" } } }
  ],
  "settings": {
    "diskAlertPct": { "type": "integer", "default": 85, "min": 50, "max": 99, "title": "Disk alert at %" }
  },
  "replaces": [ { "kind": "thread", "name": "_loop", "where": "apps/console-web/plugins/maintenance/server/routes.py" } ],
  "dataDir": "_data/host-services/maintenance",  // default
  "log": "/var/log/axf-maintenance.log"           // default
}
```

Rules:

- `id` gives the unit (`axf-<id>.service`), the timer (`axf-<id>.timer`), the socket (`/run/axf-host/<id>.sock`), the
  state folder, the log and the console-control addresses (`host:<id>`, `host:<id>/action:<action>`,
  `host:<id>/setting:<key>`, `host:<id>/unit:<start|stop|restart|run>`). A manifest may name another unit or socket
  path; it may not change the prefix (`axf-`, `/run/axf-host/`).
- `sudo` is the whole whitelist. Every line is an absolute program with fixed arguments; the only wildcard is a unit
  name `axf-*`, which `deploy/host-services/gen-sudoers.mjs` expands to every unit and timer the manifests name (so the
  file never holds a pattern). The generator refuses `ALL`, shell syntax, any other `*` and programs that hand out a
  shell or write arbitrary files (sh, bash, env, node, tee, cp, chmod, editors…), and checks the file with
  `visudo -c -f`. It writes one file, `deploy/host-services/sudoers.d/axf-host` (committed, `--check` in CI), which the
  installer copies to `/etc/sudoers.d/axf-host` (`--only` regenerates it for the installed services, so removing a
  service removes its rights). The service calls `sudo -n <cmd>` through the runner's `ctx.sudo`, which refuses
  anything else with `forbidden_command` before sudo sees it and logs the line asked for. The unit runs as `axf-host`;
  it never runs as root.
- `actions` and `settings` are the service's whole API. An action with `confirm: true` needs the console-control confirm
  token; `modes` says in which migration modes it may run (default `shadow` and `host`). Settings are plain JSON kept in
  `<dataDir>/settings.json`, merged key by key, last save wins (the editor rule), read by the runner on every tick or on
  `SIGHUP`.
- `replaces` names what the service takes over (a cron file, a console thread, a loop), so the migration knows what to
  switch off in `host` mode and back on in `container` mode. `after` lists services that must be in `host` before this
  one may cut over (→ Migration).
- The host API itself is a service (`id: host-api`, `plugin: console`, daemon) and is the only one the console must find.

### Adopted schedules

Parts that already run on the host from their own installer (the lander, the orchestrator tick, the watchdog layers,
the reaper, the build limit, the console's own crons) are in the same list with `"adopted": true`:

```jsonc
{ "$axf": "host-service@1", "id": "lander", "kind": "tick", "adopted": true,
  "unit": "axf-lander.service", "timer": "axf-lander.timer", "plugin": "gate", "runner": "deploy/lander/run.mjs" }
{ "$axf": "host-service@1", "id": "reaper", "kind": "tick", "adopted": true,
  "cron": "axf-reaper", "log": "/var/log/axf-reaper.log", "plugin": "console", "runner": "framework/cli/reaper.mjs",
  "health": { "staleSec": 900 } }
```

- **Nothing is installed, enabled, stopped or removed** by the host services installer; its owner's installer keeps
  doing that. No `sudo`, `actions` or `settings` (the owning plugin has those), no migration mode: the mode always
  reads `host`, and it is left out of the cut-over plan.
- `cron` names the file in `/etc/cron.d` that starts it, instead of `unit` and `timer` (adopted ticks only; a new
  service always gets a unit). The filled-in manifest and the state read `unit: "cron:<file>"` and carry `cron`.
  The cron file stands in for the timer (`timerState` active when it is there, else the service is down with
  `/etc/cron.d/<file> is missing`); the log's last write stands in for the last run (`health.staleSec`).
  `health.freshness: false` is for a schedule whose log is only written when something happens: only "is it still
  scheduled" is checked.
- Unit verbs: a cron schedule has none (`unknown_action`); an adopted unit can be started, restarted and run now, never
  stopped from here (the sudoers file has no `stop` line for it). The health item's fix for a missing cron file is the
  systems check's `fix` action with `host-update-cron` (the console installer writes every schedule again).
- Logs: an adopted unit's come from the journal like any unit's; a cron schedule's are the tail of its log file.

Pattern per moved part (report § 2): the pure engine stays in `framework/core`, the host runner is `deploy/<service>/`,
the unit is `deploy/systemd/axf-<id>.service` (+ `.timer` for ticks) with `@DIR@`, installed by `axf_systemd_unit` from
`framework/deploy/axf-deploy.sh` through one generic `axf_host_services_install DIR` that reads the manifests, writes the
sudoers files, creates the user and group, mounts nothing (the console compose adds `/run/axf-host:/run/axf-host` and the
group id). `axf_auto_lander_install` is called by it, not copied.

## The local API

The host API listens on the unix socket `/run/axf-host/api.sock` (owner `axf-host:axf-host`, mode `0660`; the console
container runs with the `axf-host` group so the file mode is the auth) and on loopback `127.0.0.1:7788`. The loopback
listener needs `Authorization: Bearer <AXF_HOST_TOKEN>` on every call except `/v1/health`; the installer writes the token
into `conf/env/console.env` and the host API's own env file, the same way `install-data.sh` does for axf-data. The
loopback listener is also bound on the docker bridge address so a container without the socket mount reaches it as
`http://host.docker.internal:7788`. Nothing is published outside the host.

All routes are JSON under `/v1` (`REGISTRY.routes`):

| Method | Path | Answers |
| --- | --- | --- |
| GET | `/health` | the host API itself: `{ ok, service: "host-api", at, version }`; no auth |
| GET | `/services` | `host-service-list@1`: every service as `host-service-state@1` with its manifest |
| GET | `/services/{id}` | one `host-service-state@1` + manifest |
| GET | `/services/{id}/health` | the service's own answer (daemon: forwarded over its socket; tick: the last run) |
| POST | `/services/{id}/unit/{start\|stop\|restart\|run}` | `{ ok, unit, state }` after `systemctl`; `run` starts a tick now |
| POST | `/services/{id}/actions/{action}` | `{ ok, result, at, durationMs }`; body `{ args, by, reason, confirm? }` |
| GET | `/services/{id}/settings` | `{ settings, declared }` |
| PUT | `/services/{id}/settings` | `{ ok, settings }`; body `{ set: {…}, by, reason }`, merged key by key |
| GET | `/services/{id}/logs?lines=&since=` | `{ lines: [{ at, line }] }` from `journalctl -u <unit>` (≤ 2000 lines) |
| GET | `/services/{id}/mode`, PUT | the service's migration mode (→ Migration) |
| GET | `/mode` | the whole `host-service-mode@1` document |
| POST | `/services/{id}/shadow` | the console reports what its in-container copy did; the host API compares and logs drift (→ Migration) |
| GET | `/services/{id}/shadow?since=` | `{ runs, drift: [host-shadow-drift@1] }` |
| POST | `/services/{id}/rollback` | `{ ok, steps }`: mode → container, unit stopped, timer disabled, cron restored (→ Migration) |

How a call reaches a service:

- **daemon**: the host API opens the service's socket and forwards `/health`, `/actions/<id>`, `/settings` with the same
  bodies; the service answers the same frames. A refused connect or a timeout is `host_service_down` for that id.
- **tick**: there is no process to ask. `health` is the last run from `<dataDir>/state.json` (`{ at, result,
  durationMs, message }`, written by the runner at the end of every tick); `actions` run the runner once with the action
  as its argument (`node <runner> action <id> --args <json>`) under the tick's lock (`busy` while a tick holds it);
  `settings` are the file. An adopted tick writes no `state.json`: its last run is what systemd (or its log) says.
- **unit actions** always go through `systemctl` on the host API side, never through the service.

Every write (`unit/*`, `actions/*`, `PUT settings`, `PUT mode`) carries `by` and `reason: { title, description }`, is
appended to `_data/host-services/history.jsonl` and is a `write` call under CONTROL.md's policy; `confirm` actions are
two-step like a delete. Reads run at once.

## Wire errors (host-error@1)

`{ $axf: "host-error@1", code, message, service?, action?, unit?, retryAfterMs?, requestId? }` is the body of every
non-2xx answer. The console turns the same codes into its own answers, so REST, MCP, CLI and voice all say the same.

| code | HTTP | console | when |
| --- | --- | --- | --- |
| `host_service_down` | 503 | **down** state | the unit is not active, its socket refused or timed out, or the host API itself cannot be reached (`service: "host-api"`) |
| `unknown_service` | 404 | caller | no manifest with that id |
| `unknown_action` | 404 | caller | not declared and not a unit action |
| `unknown_setting` | 404 | caller | not declared |
| `invalid_body` | 400 | caller | not JSON, bad frame, an argument outside its declared type or range |
| `invalid_manifest` | 500 | caller | a manifest on disk fails validation; the service is listed as down with this code |
| `unauthorized` | 401 | caller | loopback call without the bearer token or with a wrong one |
| `confirm_required` | 428 | confirm | a `confirm` action without a valid token |
| `forbidden_command` | 403 | caller | a service asked for a command outside its sudo whitelist |
| `mode_refused` | 409 | caller | the action is not allowed in the service's current mode (`container` = the host copy is off) |
| `busy` | 409 | retry | the action or tick is already running |
| `timeout` | 504 | retry | no answer within `health.timeoutMs` (or the action's `timeoutMs`) |
| `internal` | 500 | retry | anything else; `message` carries `requestId` |

The console's rule (`core/host-services.mjs` → `toHostError`, s4): any transport failure to the host API (`ENOENT` on the
socket, `ECONNREFUSED`, a timeout) is `host_service_down` with `service: "host-api"`; a `host-error@1` body is passed
through as is; any other non-2xx without a frame is `internal`. A `down` code on a plugin's REST route answers 503 with
the same body, the MCP tool returns it as the tool error, the CLI exits 3 and prints the message, voice says the message.

## The state the UI reads (host-service-state@1)

```
{ $axf: "host-service-state@1", id, unit, kind, plugin, status: up | degraded | down | unknown, since, at, reason, code,
  unitState, timerState?, enabled, pid, restarts, activeSince, health: { ok, at, message, latencyMs } | null,
  lastRun: { at, result: ok | error | skipped | timeout, durationMs, message } | null, mode, reachable }
```

| status | daemon | tick |
| --- | --- | --- |
| `up` | `unitState` active and the last health probe `ok` within `intervalSec × 2` | timer active, last run `ok` and younger than `staleSec` |
| `degraded` | unit active but the probe failed, timed out or is older than two intervals; or `restarts` grew since the last state | timer active but the last run is `error`, `timeout` or older than `staleSec`; or the unit is `activating` past its timeout |
| `down` | unit `inactive` or `failed`, socket refused, `invalid_manifest`, or the mode is `container` (host copy off, by design) | timer inactive, unit `failed`, or mode `container` |
| `unknown` | the host API itself could not be reached (`reachable: false`); every service shows this at once | same |

`since` is the moment the status last changed, carried forward by the host API from its previous state file, so the UI
can say "down since 09:14". The `host-api` row is the console's own view (did the last call succeed), not something the
host API answers about itself. A `down` or `unknown` service is a health@1 item `host-service:<id>` in the systems check
banner with Auto fix = `unit/restart` (or `unit/start` for an inactive timer), pushed once to the phone; `degraded` is
a warn item without a push. The state is pure: `serviceState(manifest, facts, previous, now)` in the engine (s4).

## How the console finds services

1. **Address.** `AXF_HOST_API` (default `unix:/run/axf-host/api.sock`), then `AXF_HOST_API_FALLBACK` (default
   `http://host.docker.internal:7788`) with `AXF_HOST_TOKEN`. The engine's `resolveEndpoints(env)` gives the ordered
   list; the client tries the socket, then the fallback, once each, and reports `host_service_down` for `host-api` when
   both fail. The installer writes the three variables into `conf/env/console.env` and mounts `/run/axf-host`.
2. **List.** `GET /v1/services` is the only discovery call. The console never scans `deploy/` for manifests; the host API
   does. A plugin's `plugin.json` may list `hostServices: ["<id>"]` so the Plugin Manager shows the row even while the
   host API is down (then as `unknown`).
3. **Surface.** Every service is on all four transports through the console: REST `/api/host-services[/{id}/…]` (same
   paths as the host API, same bodies), MCP tools `host_service_list / get / health / action / settings / logs / unit /
   mode`, CLI `axf host <list|status|health|logs|action|set|unit|mode> …`, voice through console control. Console-control
   addresses: `host:<id>` (open the row), `host:<id>/action:<action>`, `host:<id>/setting:<key>`, `host:<id>/unit:<verb>`
   (`restart`, `stop` and `confirm` actions need `confirm`).
4. **Place in the UI.** Settings → Plugins → Host services (one row per service: status chip with `since`, mode, unit,
   health, last run, Logs, Restart, Run now, its actions and settings) plus a status chip on each owning plugin's Plugin
   Manager entry; `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=host-services` is its deep link (`settings.open:host-services`).

## Migration

Every service moves on its own, in three modes, the way data-store-mode@1 moves a namespace. The document is
`host-service-mode@1` at `_data/host-services/mode.json` on the host (`/projects/amberx-axf/_data/...` from the console),
schema `framework/schemas/host-service-mode.json`; both sides read it before every tick, so a flip takes effect within
one tick and nothing waits for a restart. The default is always `container`: a service with no entry has not moved.

```
container ──start shadow──▶ shadow ──cut over──▶ host
    ▲                         │  ▲                 │
    └────back to container────┘  └───step back─────┤
    ◀──────────────────roll back───────────────────┘
```

| mode | container copy | host copy | unit / timer | cron files in `replaces` | reads and actions go to |
| --- | --- | --- | --- | --- | --- |
| `container` | does the work | off (`AXF_HOST_MODE=off`: a tick exits `skipped`, a daemon serves health only) | installed, stopped, timer disabled | present | the container |
| `shadow` | does the work | runs the same tick in dry-run (`AXF_HOST_MODE=shadow`): computes what it would do, performs nothing, writes `effects` to `<dataDir>/shadow.jsonl` | enabled and running | present | the container |
| `host` | sees the mode and skips (its loop stays alive, idle) | does the work (`AXF_HOST_MODE=host`) | enabled and running | removed | the host API |

`MODE_PLAN` / `modePlan(manifest, mode)` in the engine is that table with the concrete unit, timer, cron files and
container loops of one service. The console's loops named in `replaces` (`thread`, `loop`) check the mode at the top
of every iteration and return when it is `host`; the console's REST routes for the plugin read through the host API in
`host` mode and from the local copy otherwise (`readsFrom`). An action called in a mode that does not allow it answers
`mode_refused` (actions default to `shadow` and `host`; a destructive one like Clear Docker cache declares `modes:
["host"]` so it never runs twice).

### Shadow: proving the host copy

In shadow the console posts what its copy did after every run (`POST /v1/services/{id}/shadow { at, result, effects,
error? }`); the host API pairs it with the host's dry-run of the same tick and writes a `host-shadow-drift@1` entry when
they differ (`result-differs`, `effect-differs`, `host-error`, `container-error`, `host-missing`, `container-missing`;
`shadowDrift` in the engine). Each agreeing pair counts a clean run (`runs`), each entry counts `drift` and sets
`lastDriftAt` on the service's mode entry (`recordShadowRun`). `GET /v1/services/{id}/shadow` lists both.

### Guards (`canChangeMode`)

| event | from → to | allowed when |
| --- | --- | --- |
| `start-shadow` | container → shadow | the host API is up and the unit is installed (`axf_host_services_install` ran) |
| `cut-over` | shadow → host | every service in the manifest's `after` is in `host`; shadow quiet (no drift) for `minShadowMs` (30 min) and at least `minRuns` (3) clean runs; no drift entries beyond those accepted by id (`acceptDrift`); the host copy's state is `up` right now |
| `step-back` | host → shadow | always |
| `roll-back` | host → container | always |
| `back-to-container` | shadow → container | always |

There is no `container → host`: shadow first, every time. `host-api` has no mode (it is the host side; `host` once it
answers). The whole document moves only one service at a time or a list (`changeMode`), each with `by`, `reason` and a
`why` kept on the entry's `rollbackOf` for any backward move; `rev` grows on every change and `history.jsonl` records
it.

### The order to cut over (`cutoverOrder`)

A tier at a time: every service of a tier is in `host` before the next tier starts shadow. `CUTOVER_TIERS` places the
services from the audit; a manifest's `after` adds finer ordering inside a tier (and is a cut-over guard); anything a
later build adds and does not place sits in `rest`.

| tier | services | why |
| --- | --- | --- |
| 1 gateway | `host-api` | nothing else is reachable without it |
| 2 publishers | `builds-live`, `hub-sync` | everything else reads what they keep current (main, the hub) |
| 3 independent loops | `maintenance`, `shipped-features` | no console coupling beyond their own data folder |
| 4 host actions | `systems-check`, `agent-swarm` | they start sessions and run fixes, so the publishers go first |
| 5 rest | (unplaced) | anything a later build adds and does not place |

Adopted schedules (→ Adopted schedules) are not in the plan: they are on the host already.

`migrationNext(modeState, manifests, ctxById)` gives the next step per service in that order: `install` (unit missing),
`shadow`, `wait` (with the guard's reason), `host`, `done`. The CLI (`axf host migrate [next|status|<id> shadow|host|
container]`), the console's Migration card (Settings → Plugins → Host services → Migration) and the MCP tool
`host_service_mode` call the same functions; `PUT /v1/services/{id}/mode` is a `write`, backward moves ask `confirm`
only when the service has an action running (`busy` otherwise).

### Rollback (`rollbackSteps`)

Rollback is `roll-back` (host → container) or `step-back` (host → shadow), always allowed, run by the host API in this
order; every step is idempotent and a failed step leaves the mode at its new value so nothing runs twice:

1. **Flip the mode** (`PUT /v1/services/{id}/mode`). Both sides read it before every tick: the container copy resumes
   on its next iteration, the host tick exits `skipped`, a host daemon drops to health-only.
2. **Stop the unit**: `systemctl disable --now axf-<id>.timer` and `systemctl stop axf-<id>.service` (daemon: stop
   only). For `step-back` the unit stays up and serves dry-run.
3. **Put the cron files back** from `deploy/install-console.sh` (`axf_cron_file` for each `replaces: cron` name).
4. **Verify the container copy ran**: the console's `GET /api/host-services/{id}` carries `container: { lastRun }`; a
   run younger than `staleSec` closes the rollback. Until then the systems check shows the service as `container
   (resuming)`.
5. **Record**: `history.jsonl` gets the roll-back with `by` and `why`; the health@1 item `host-service:<id>` clears
   (the state is `down` by design in `container` mode, and `healthItem` gives it no fix and no push).

A rollback of the whole tier (`changeMode` with `ids`) runs the steps per service in reverse cut-over order. Rolling back
`host-api` is stopping the unit: every other service shows `unknown` until it is back, and their units keep running
unchanged, so a dead host API never stops a service that was already in `host`.

### What never moves

The console's UI, its REST / MCP / CLI / voice surface, the read-only git views (crew-live, codebase-changes,
whats-shipped), the plugin command registry, recorders and anything in audit § 1b stay in the container in every mode.

## Related contracts

- `DATA-STORE.md` → Modes: the shape this migration follows (per-namespace mode with a store default).
- `GATE.md` / `PIPELINE-2.md`: the lander (`axf-lander`), the orchestrator tick and the watchdog layers, adopted here.
- `CONSOLE-CONTROL.md`: the addresses and the confirm rule every action here uses.
- `CONTROL.md`: read / write / confirm policy for calls through axHub.
