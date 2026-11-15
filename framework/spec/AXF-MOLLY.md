# AXF-MOLLY — the container that runs the orchestrator, gate, lander and Shipped sender (axf-molly@1)

Status: contract and first cut, build `axf-molly-container-orchestrator-gate` (Fable, Nov 15 2026). Reference engine
`framework/core/axf-molly.mjs` (pure), constants mirrored in `framework/schemas/axf-molly.json`, check
`node framework/spec/check-axf-molly.mjs` (fixtures `framework/spec/fixtures/axf-molly.json`), container
`apps/axf-molly`, host bridge `deploy/molly-bridge.mjs`, installer `deploy/install-molly.sh`. No Kotlin twin: VPS
infrastructure no Android app renders (deferred gap in `PORTING.md`).

## Why

Brett, Nov 15 2026: "Yes do those containers and wire them and migrate everything asap. Molly's gonna run the
orchestrator from now on, so let's name it AXF Molly."

Until now the work ran in three places: the console container (screens and most routes), host crons (`axf-pipeline`
every minute, `axf-auto-land` every 3 minutes, `axf-builds-reconcile` every 10) and a `docker exec` back into the
console for alerts. A console rebuild or outage stalled builds at the first write and nothing landed. The final layout:

| Part | Does | Holds |
|---|---|---|
| console | screens only | nothing of the orchestrator's |
| **axf-molly** | all the work: dispatcher tick (intake / split, session ends, launches, slots and account routing), reconciler, gate rules engine, auto-lander + merge queue (with the one `Merge queue on/off` switch), merge watch + Shipped features sender | the owner lease and the shadow log |
| axHub | routes + credentials + approvals; registers axf-molly as a downstream and exposes its tools | no screens, no data |
| axf-data | all data (data-store@1, build `data-container-axf-data-holds-all`) | the builds store, pipeline state, everything |

## Records

```
molly-lease@1       = { $axf, rev, owner: console | axf-molly, mode: shadow | cutover | undo, since, until, by, reason, prev, history[] }
molly-shadow-diff@1 = { $axf, at, kind: tick | lander | reconcile | ship | mode | drill, same, count, diffs: [{ what, id, mine, theirs }], mine?, theirs?, note? }
host-bridge@1       = request { $axf, id, cmd, args[] }  →  reply { $axf, id, ok, status, stdout, stderr, error, ms }
molly-status@1      = { $axf, at, side, owner, acting, why, lease, shadow: { lines, differing, lastAt, lastDiffAt, cleanForMin, readyForCutover }, jobs, data, bridge, version }
axhub-downstream@1  = { $axf, service: 'axf-molly', url, tools: [{ name, method, path, mutates, approval, says }], equivalents, reason }
```

## Who acts: the owner lease

Two sides can do the work: the **console side** (today's host crons and the console container) and **axf-molly**.
Exactly one acts at a time; the lease says which. It lives at `<pipeline dir>/molly/lease.json` on the hub mount both
sides see (and, when axf-data is up, as `builds/molly/lease.json` through data-store@1).

- `shadow` (the installed state): the console side owns. axf-molly runs every job in its dry form and appends a
  `molly-shadow-diff@1` line comparing its plan with what the console side did (the dispatcher's `state.json`, the
  lander's `land.json`, the reconciler's report). `shadowSummary` says how long the log has been clean;
  `readyForCutover` after `cleanMin` (60) minutes without a difference.
- `cutover`: `cutover(lease, { by, reason, ttlMin })`. A reason is required (History shows it). axf-molly owns while
  `until` is in the future; the container calls `renew` every minute (LEASE_TTL_MIN = 30). The host's tick runs as a
  shadow tick (plan only, plus the account snapshot and health sweep the container cannot do: the logins are on the
  host); the host's lander and reconciler crons are gated by `molly.mjs owner console` and do nothing.
- expiry: a container that dies stops renewing. `leaseOwner` answers `console` the moment `until` passes, so the host
  crons act again by themselves. Builds keep running through all of it: the store, worktrees, tmux sessions and the
  dispatch gate are the same objects on both sides; only the hand that moves them changes.
- `undo`: back to shadow at once, recorded as a history step `mode: undo`.

The gate inside the code: `pipeline.mjs tick()` checks `canAct(lease, AXF_MOLLY_SIDE)` first (AXF_MOLLY_GATE=off for
tests of the tick itself); `molly.runTool` refuses `exclusive` tools (tick, lander run, Shipped send) to a side that
does not own (409), everything else (queue moves, holds, routes, notes, switches) is a store write either side may do.

## Tools: one list, four doors

`TOOLS` names every action: `orchestrator.*` (status, tab, show, accounts, request, queue, unqueue, hold, release,
split, route, step, note, tick, selfcheck), `gate.*` (rules, set, state), `lander.*` (status, queue, on, off, now, hold,
release, run), `features.*` (list, show, landed, ship), `molly.*` (status, shadow, cutover, undo, renew). Each carries
its HTTP method and path (under `/v1` on the container), the repo CLI that does it, whether it mutates, whether only the
owner may run it, and the voice line (`says`).

| Door | How |
|---|---|
| REST | `GET/POST http://axf-molly:7510/v1/<path>`, `Authorization: Bearer AXF_MOLLY_TOKEN` (never published; internal Docker network). A change carries `reason: { title, description }` (axHub's rule; `AXF_MOLLY_REASON=required` enforces it). `GET /v1/health` needs no token |
| console API | `GET /api/build-orchestrator/pipeline/molly`, `POST …/pipeline/molly/{cutover|undo}`, `GET …/pipeline/molly/shadow`; while axf-molly owns and `AXF_MOLLY_URL` is set, `tick` and `selfcheck` are forwarded to it. These routes are plugin commands (plugin-commands@1 `auto`), so MCP gets them |
| axHub | `molly.mjs axhub-service` prints `axhub-downstream@1`: every tool with method, path and `approval: reason` on changes; equivalents `axf-console.build_orchestrator_pipeline_request → orchestrator.request`, `planner.builds → orchestrator.status`, `vps.build_land → lander.now`. Registration is on axHub's side (`axhub service add`, Coolify terminal) |
| CLI | `node apps/axf-molly/molly.mjs tool <name> k=v…`; with `AXF_MOLLY_URL` + token it calls the container |
| voice | the `says` line per tool |
| screens | `CONSOLE_TARGETS`: orchestrator → `view:build-orchestrator`, gate and lander → `view:gate-rules`, features → `view:shipped-features`; the dispatcher's alerts link with `view:build-orchestrator` (was `#/build-orchestrator`, which the bell did not open) |

Gate tools before the gate plugin lands (`gate-rules-plugin-in-the-console`, framework/core/gate-rules.mjs): `gate.rules`
reads the lander's config as three rules (merge-queue, ui-review, auto-land), `gate.set merge-queue enabled=on|off` is
the one settable switch, `gate.state` is the lander status. Once `apps/console-web/plugins/gate-rules/gate.mjs` exists
the tools call it.

## Host bridge: exactly what it can touch

The container holds no Docker socket. It mounts `/run/axf-molly/bridge.sock`; `deploy/molly-bridge.mjs` (systemd
`axf-molly-bridge.service`, root, `NoNewPrivileges`) answers one JSON request per connection and runs only
`BRIDGE_COMMANDS`, checked on both ends with the patterns in the engine (`bridgeCheck`):

| Command | Arguments | Touches on the host |
|---|---|---|
| `tmux.has` / `tmux.list` / `tmux.capture` | `axf-*` session name, lines | tmux, read |
| `tmux.kill` | `axf-*` session name | tmux kill-session of one axf session (the stale reaper) |
| `launch` | build, account, model, brief, log, token?, priority? | `deploy/claude-headless.sh` in `/root/axf-builds/<build>`; the claude argv is rebuilt on the host from the model name, never taken from the request; the dispatch token is the request's or none |
| `worktree.ensure` | build | `git worktree add` under `/root/axf-builds` from the main checkout (pipeline.mjs ensureWorktree) |
| `git` | build, sub ∈ status log rev-parse diff show branch fetch worktree(list) ls-files, options | read-only git inside that worktree; writing/executing options refused |
| `claude.probe` / `pipeline.health` | account | `pipeline.mjs probe` / `health` on the host's Claude logins (never a build, never a token out) |
| `accounts.list` | | account names and states (never a token) |
| `events.tail` | lines | `/var/tmp/axf-headless/events.jsonl`, read |
| `bridge.ping` | | nothing |

Never: the Docker socket; docker, systemctl, apt or any package manager; files outside `/root/axf-builds`, `/opt/axf`
(read) and `/var/tmp/axf-headless` (read); a Claude token; a shell (every command is an argv list). The daemon logs
command, arguments, status and ms to `/var/log/axf-molly-bridge.log`; a launch is logged without its token.

Inside the container `PATH` puts `apps/axf-molly/bin` first: `tmux` and the launcher (`AXF_PIPELINE_LAUNCHER`) are shims
over the bridge, so pipeline.mjs, agent-slots and build-lock run unchanged.

## Container

`deploy/install-molly.sh` builds `apps/axf-molly/Dockerfile` and runs `axf-molly` on Coolify's Docker network with no
Traefik labels and no published port (`axf.private=true`), `--restart unless-stopped`, health check on `/v1/health`.
Mounts: the host clone at `/opt/axf` (same path as on the host so git worktrees resolve on both sides), `/root/axf-builds`,
the hub's `axhub-projects` volume at `/projects` (pipeline state and the lease), `/run/axf-molly` (the bridge socket),
`/var/tmp/axf-headless` read-only (session-end events). Env from `/opt/axf/.axf-molly/env`: `AXF_MOLLY_TOKEN`, the
console token (alerts over `AXF_CONSOLE_URL=http://axf-console:7090`, no `docker exec`), `AXF_DATA_URL` when axf-data is
up. Jobs (`CADENCE`): tick 60 s, lander 180 s, reconcile 600 s, lease 60 s.

Name: `axf-molly` does not clash with the retired standalone Molly app's container `molly`. What that app left behind,
listed for retirement by `molly.mjs retire` and the installer (nothing deleted by code): container `molly`
(`molly:latest`, Coolify network, Traefik `molly.amberxai.com`), image `molly:latest`, cron `/etc/cron.d/molly`, script
`/usr/local/bin/molly-update`, folder `/opt/molly`, the domain, and `apps/molly` in this repo.

## Data

Everything the jobs read and write already goes through the builds store, the pipeline folder and the lander's data
folder on the hub mount; `data-container-axf-data-holds-all` moves those onto axf-data (namespace `builds`). The lease
and the shadow log use the data-store@1 client when `AXF_DATA_URL` is set (keys `builds/molly/lease.json`, journal
`builds/molly/shadow`) and keep a file mirror; until axf-data is up (its API and client are on PR #704) they are files on
the hub mount. Nothing is written to repo files by the container except through builds-live (the store's status
commits), as today.

## Staging

1. **Shadow** (now): install, watch `molly.mjs status` and `shadow`. Differences name the build and both sides' view.
2. **Cutover**: `molly.mjs cutover --reason "…"` (or `POST /api/build-orchestrator/pipeline/molly/cutover`). Builds keep
   running; the next tick, landing round and Shipped send happen in the container. History: the lease's steps.
3. **Undo**: `molly.mjs undo --reason "…"`. Back to shadow at once.
4. **Console-down drill**: `molly.mjs drill` with the console stopped (`docker stop axf-console`; the bridge cannot do it)
   proves the tick, a lander round and the Shipped sender run in the container; alerts to the console return null and
   the tick goes on. Start the console again afterwards (`docker start axf-console`).

## Fixed on the way

- A phase-end build is never parked in Pending: `outcomeOf` takes `progressed` (steps ticked during the run, from the
  new `pipeline.stepsOpen` the dispatcher records at launch) and the model compare uses `modelKey`; a clean exit with
  steps left goes back to the Queue unless the run ticked nothing on the same model. The reconciler's `idlePlan` sends a
  running build whose session is gone to the Queue, not Pending, and `checkEnds` closes the run record of a Queued build
  that still carries a session.
- Dispatcher alerts link `view:build-orchestrator`.
- `merge-queue.mjs settings --off` (the switch had only `--on` from the CLI).
