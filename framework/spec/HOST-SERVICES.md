# HOST-SERVICES — host-service@1, the console's server side on the VPS host

Status: contract since Nov 17 2026 (build `move-server-side-console-parts-onto-vps`, Fable phase; Brett: "So shouldn't we
move everything to the VPS except for the UI itself for the console? ... All right, do it."). Reference engine:
`framework/core/host-services.mjs` (pure). Registry snapshot: `framework/schemas/host-service.json`. JSON Schemas:
`schemas/json/host-service.schema.json`, `host-service-state.schema.json`, `host-error.schema.json`; the mode file
`framework/schemas/host-service-mode.json` (→ Migration). Fixture: `framework/spec/fixtures/host-services.json`
(`spec/check-host-services.mjs`). Audit and reuse notes: `_claude/builds/reports/move-server-side-console-parts-onto-vps.md`.
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

One file per service: `deploy/<service>/host-service.json`. The host API reads every `deploy/*/host-service.json` at
start and on `SIGHUP`; `node framework/spec/check-host-services.mjs` validates every manifest in the repo in CI.

```jsonc
{
  "$axf": "host-service@1",
  "id": "maintenance",                           // ^[a-z0-9][a-z0-9-]{0,40}$; everything else derives from it
  "title": "Maintenance monitor",
  "description": "Disk, swap and nightly maintenance; the Clear Docker cache action.",
  "kind": "daemon",                              // tick | daemon
  "unit": "axf-maintenance.service",             // axf-<id>.service unless stated; a tick also names its "timer"
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
- `sudo` is the whole whitelist. Every line is an absolute program with fixed arguments (a trailing ` *` allows
  arguments). The service calls `sudo -n <cmd>`; anything else is `forbidden_command`, logged with the line asked for.
  The installer writes the union of every manifest's lines to `/etc/sudoers.d/axf-<id>` (one file per service, so
  removing a service removes its rights). The unit runs as `axf-host`; it never runs as root.
- `actions` and `settings` are the service's whole API. An action with `confirm: true` needs the console-control confirm
  token; `modes` says in which migration modes it may run (default `shadow` and `host`). Settings are plain JSON kept in
  `<dataDir>/settings.json`, merged key by key, last save wins (the editor rule), read by the runner on every tick or on
  `SIGHUP`.
- `replaces` names what the service takes over (a cron file, a console thread, a loop), so the migration knows what to
  switch off in `host` mode and back on in `container` mode.
- The host API itself is a service (`id: host-api`, `plugin: console`, daemon) and is the only one the console must find.

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

How a call reaches a service:

- **daemon**: the host API opens the service's socket and forwards `/health`, `/actions/<id>`, `/settings` with the same
  bodies; the service answers the same frames. A refused connect or a timeout is `host_service_down` for that id.
- **tick**: there is no process to ask. `health` is the last run from `<dataDir>/state.json` (`{ at, result,
  durationMs, message }`, written by the runner at the end of every tick); `actions` run the runner once with the action
  as its argument (`node <runner> action <id> --args <json>`) under the tick's lock (`busy` while a tick holds it);
  `settings` are the file. The auto-lander is the first tick: its `auto-lander.mjs status` becomes its health.
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
   Manager entry; `view:settings/tab:settings.tabs=plugins/tab:plugins.tabs=host-services` is its deep link.

## Migration

See s5 of this build: the per-service mode (`container`, `shadow`, `host`), the cut-over order and rollback are added
here as "Migration" once the mode file schema (`framework/schemas/host-service-mode.json`) exists.

## Related contracts

- `DATA-STORE.md` → Modes: the shape this migration follows (per-namespace mode with a store default).
- `GATE.md` / `AUTO-LANDER.md`: the first host unit (`axf-auto-lander`); its status is the first tick health.
- `CONSOLE-CONTROL.md`: the addresses and the confirm rule every action here uses.
- `CONTROL.md`: read / write / confirm policy for calls through axHub.
