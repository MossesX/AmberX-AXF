# axf-molly container: orchestrator, gate, lander, Shipped sender

Build `axf-molly-container-orchestrator-gate` · Phase 1 (Fable) · Nov 15 2026 · branch `claude/axf-molly-container-orchestrator-gate`

Brett (Nov 15 2026 12:20): "Yes do those containers and wire them and migrate everything asap. Molly's gonna run the
orchestrator from now on, so let's name it AXF Molly."

## Result

AXF Molly is running on the VPS as a private container (`axf-molly`, Coolify network, no port, no domain, restart
unless-stopped, health check) in **shadow mode**: it computes the dispatcher tick, a lander round and the reconciler on
its own cadence and logs every difference to what the console side does. Cutover is one command and undoable; builds
keep running through the switch. The spec is `framework/spec/AXF-MOLLY.md`.

| Part | Where | State |
|---|---|---|
| axf-molly@1 contract (owner lease, shadow diff, bridge allow-list, tool list, axHub record) | `framework/core/axf-molly.mjs`, `framework/schemas/axf-molly.json`, `framework/spec/check-axf-molly.mjs` + fixtures | 28 checks green |
| container | `apps/axf-molly` (server, loop, CLI, bridge client, shims, drill, Dockerfile) | built and running, 10 tests green |
| host bridge | `deploy/molly-bridge.mjs`, `deploy/axf-molly-bridge.service` | installed, active, answering |
| installer | `deploy/install-molly.sh` | run once from this worktree; re-run from `/opt/axf` after landing |
| console API + MCP | `GET /api/build-orchestrator/pipeline/molly`, `POST …/molly/{cutover,undo}`, `GET …/molly/shadow`; tick/self-check forwarded while axf-molly owns | in the plugin server (plugin-commands auto) |
| host crons | tick checks the lease itself; lander and reconciler gated by `molly.mjs owner console` | rewritten on the host |
| fixes on the way | phase-end builds never parked in Pending (outcomeOf `progressed`, `pipeline.stepsOpen`, reconciler idlePlan → queued, checkEnds closes queued runs); alert links `view:build-orchestrator`; `merge-queue settings --off` | tests updated and green |

## What the container does today (shadow)

Every minute: `pipeline.mjs tick` runs its shadow form (plan only); the plan is compared with the host tick's
`state.json` and a `molly-shadow-diff@1` line is appended. Every 3 minutes: the lander state is read (dry). Every 10
minutes: `builds-reconcile.mjs` dry. The lease is read every minute. Alerts go to the console over the Docker network
(`AXF_CONSOLE_URL`), not `docker exec`.

Interim: this first deploy was built from the build's worktree because `/opt/axf` (main) has no `apps/axf-molly` yet, so
the image carries that checkout and `/opt/axf` is not mounted. Its view of the builds store is therefore the worktree's
copy and the first shadow lines differ on which builds are running. Once the PR lands, `bash deploy/install-molly.sh`
from `/opt/axf` mounts the live clone at the same path (and installs the 10-minute auto-update cron); from then on the
shadow log compares like with like.

## How each feature is reached (no UI-only parts)

| Feature | Screen | REST | MCP / axHub | CLI | Voice |
|---|---|---|---|---|---|
| who runs the work, lease, shadow summary | `view:build-orchestrator` (indicator: follow-up) | `GET /api/build-orchestrator/pipeline/molly`; container `GET /v1/status` | plugin command (auto); `axf-molly.molly.status` | `molly.mjs status` | "who runs the work" |
| cutover / undo | same | `POST …/pipeline/molly/cutover` `{reason}`, `…/undo`; container `POST /v1/mode/cutover` | `axf-molly.molly.cutover` / `.undo` | `molly.mjs cutover --reason … | undo` | "axf-molly takes the work" / "back to shadow" |
| shadow log | same | `GET …/pipeline/molly/shadow?tail=` ; container `GET /v1/shadow` | `axf-molly.molly.shadow` | `molly.mjs shadow` | "the shadow diff log" |
| orchestrator actions | `view:build-orchestrator` | container `/v1/orchestrator/*` | `axf-molly.orchestrator.*` | `molly.mjs tool orchestrator.queue id=…` | per-tool `says` |
| merge queue on/off, lander | `view:gate-rules` | `/v1/lander/on|off`, `/v1/lander/*` | `axf-molly.lander.*` | `molly.mjs tool lander.off` | "switch the merge queue off" |
| gate rules | `view:gate-rules` | `/v1/gate/rules`, `/v1/gate/rules/{rule}` | `axf-molly.gate.*` | `molly.mjs tool gate.rules` | "the gate rules" |
| Shipped features | `view:shipped-features` | `/v1/features*` | `axf-molly.features.*` | `molly.mjs tool features.landed` | "send Shipped features" |

## Needs Brett

1. **axHub registration** (axHub's side, Coolify terminal): register the downstream from `node apps/axf-molly/molly.mjs
   axhub-service` (service `axf-molly`, `http://axf-molly:7510`, every tool listed, changes need a reason). The hub
   repo is outside this one.
2. **Old standalone Molly, retirement list** (nothing deleted): container `molly` (molly:latest, molly.amberxai.com),
   image `molly:latest`, `/etc/cron.d/molly`, `/usr/local/bin/molly-update`, `/opt/molly`, the domain in Coolify, and
   `apps/molly` in the repo.
3. **Cutover** when `molly.mjs status` says ready: `node apps/axf-molly/molly.mjs cutover --reason "…"`. Undo any time.
4. **Console-down drill** needs a host shell (the bridge cannot stop containers): `docker stop axf-console`, then
   `node apps/axf-molly/molly.mjs drill`, then `docker start axf-console`. Not run yet: it only proves something after the
   cutover.

## Not done in this phase

- The orchestrator screen's "who runs the work" indicator and the cutover button (the API exists; UI Review needed).
- axf-data is not up (PR #704 is the contract and client): the lease and shadow log use the data-store@1 client when
  `AXF_DATA_URL` is set and are files on the hub mount until then; the builds store itself moves with that build.
- The gate plugin (`gate-rules-plugin-in-the-console`) has not landed: `gate.*` tools fall back to the lander's config.

## Tests

`node framework/spec/check-axf-molly.mjs` (28), `node apps/axf-molly/test.mjs` (10, bridge end to end over a temporary
socket), `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs` (52), `check-builds-live.mjs` (68),
`check-builds-store.mjs` (40), `check-build-steps.mjs` (44), push-banner `land.test.mjs` (108), `merge-queue.test.mjs` (18).
