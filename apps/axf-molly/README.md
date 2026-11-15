# AXF Molly (`axf-molly`)

The container that runs the work the console used to run from the VPS host: the orchestrator's dispatcher tick
(intake / split, session ends, launches, account routing), the builds reconciler, the gate rules, the auto-lander and
merge queue, and the merge watch that sends Shipped features. Brett, Nov 15 2026: "Molly's gonna run the orchestrator
from now on, so let's name it AXF Molly."

Contract: `framework/spec/AXF-MOLLY.md` (axf-molly@1, engine `framework/core/axf-molly.mjs`, check
`framework/spec/check-axf-molly.mjs`). Install: `deploy/install-molly.sh`. Host bridge: `deploy/molly-bridge.mjs`.

## Layout

| Part | Does | Holds |
|---|---|---|
| console (`axf-console`) | screens only | nothing of the orchestrator's |
| **axf-molly** | all the work (dispatcher, reconciler, gate, lander, Shipped sender) | the owner lease and the shadow log (through axf-data when it is up) |
| axHub | routes, credentials, approvals; `axf-molly.*` tools | no data |
| axf-data | all data (data-store@1) | the builds store, pipeline state, everything else |

## Files here

| File | What |
|---|---|
| `server.mjs` | the container process: HTTP API on 7510 (internal network only) + the job loop (tick 1 min, lander 3 min, reconcile 10 min, lease 1 min) |
| `molly.mjs` | CLI and library: `status`, `owner`, `cutover`, `renew`, `undo`, `shadow`, `tools`, `tool <name> k=v…`, `retire`, `axhub-service`, `drill` |
| `bridge-client.mjs` | the container's side of the host bridge (one JSON request per connection on a Unix socket) |
| `bin/tmux`, `bin/claude-headless.sh` | shims first on PATH: tmux calls and the build launcher go over the bridge, never run in the container |
| `drill.mjs` | the console-down drill: tick, lander round and Shipped sender run here while the console is stopped |
| `test.mjs` | handler, owner-only refusals, CLI shaping, lease round trip, bridge end to end |
| `Dockerfile` | plain Node 22 + git + curl; `tini`; health check on `/v1/health` |

## Modes

- **shadow** (installed this way): the console side acts, axf-molly computes the same plan and appends every difference
  to the shadow log (`molly.mjs shadow`). `status` says `ready for cutover` after a clean hour.
- **cutover**: `molly.mjs cutover --reason "…"`. axf-molly owns the work under a 30-minute lease it renews every
  minute; the host's tick, lander and reconciler compute but act on nothing. Builds that are running keep running: the
  store, the worktrees and the tmux sessions are the same on both sides.
- **undo**: `molly.mjs undo --reason "…"` goes back to shadow at once. A container that dies stops renewing: the lease
  expires and the console side acts again by itself.

## Reaching it

Every action is one tool (`molly.mjs tools`): `orchestrator.*`, `gate.*`, `lander.*`, `features.*`, `molly.*`.

| Door | How |
|---|---|
| REST | `GET/POST http://axf-molly:7510/v1/<path>` with `Authorization: Bearer $AXF_MOLLY_TOKEN` (`/opt/axf/.axf-molly/env`); a change carries `reason: { title, description }` |
| console API | `GET /api/build-orchestrator/pipeline/molly`, `POST …/pipeline/molly/cutover|undo`, `GET …/pipeline/molly/shadow`; the orchestrator's tick and self-check are forwarded while axf-molly owns |
| MCP | the console routes above are plugin commands (plugin-commands@1, auto); axHub exposes `axf-molly.<tool>` from `molly.mjs axhub-service` |
| CLI | `node apps/axf-molly/molly.mjs …` (with `AXF_MOLLY_URL` + `AXF_MOLLY_TOKEN` it calls the container; inside it, it runs the tool) |
| voice | the tool's `says` line is the AmberX phrase (`molly.mjs tools`) |
| screen | `view:build-orchestrator` (orchestrator), `view:gate-rules` (gate, lander), `view:shipped-features` |

## Host bridge

The container never gets the Docker socket. It mounts `/run/axf-molly/bridge.sock`; the host daemon runs the fixed
command list in `BRIDGE_COMMANDS` and nothing else (`node deploy/molly-bridge.mjs check` prints it with what each one
touches). Log: `/var/log/axf-molly-bridge.log`, never a token.
