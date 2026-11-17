# Server watchdog: the orchestrator auto-recovers stuck or killed builds

Build `server-watchdog-orchestrator-auto-recovers-stuck` · branch `claude/server-watchdog-orchestrator-auto-recovers-stuck`
· phase 1 (Fable, s1–s3: the build-watchdog@1 contract) · phase 2 (Opus, s4–s21: everything below).

## What Brett said (Nov 13 2026, verbatim)

> Brett: if anything stops working, the server/orchestrator fixes it automatically with no one asking. Detect builds
> marked running with no live session (e.g. killed exit 143, failed exit 1), reset and requeue them, retry failed
> sessions, keep every slot filled, and send an FYI to the phone for each fix. Never wait for Brett to notice.

## Before / after

| | Before | After |
|---|---|---|
| A build killed (143) or failed (1) while the dispatcher missed its end | stayed **running** in the store, its slot taken, until someone noticed | the next watchdog minute resets the step, frees the slot, requeues it and relaunches it |
| Evidence of how a run ended | only a `session-end` line in events.jsonl, lost when the wrapper itself died | exit, signal, kind, usage / login stop, account, time on the build (`pipeline.runEnd`, live on main) and `<slots>/runs/<build>.json`, written the moment claude exits, HUP / TERM included |
| Is a build alive? | three partial checks in three places | `agent-slots.mjs alive <build>`: pid, tmux, heartbeat (log / meter), exit, in one probe; `reap` frees orphan slots |
| Retries | the dispatcher's crash count only for ends it saw | up to Max retries (3) since the last ticked step, counted from the build's own `recoveries[]`; a usage limit / dead login moves to the next worker account; past the cap: Pending, banner item, alert |
| Hung sessions | nothing | no heartbeat for staleMin (20) with the process alive: killed, then retried |
| Idle slots with Queue work | an idle alert after a while | every pass ticks the dispatcher while slots are free; still idle = an `idle-slots` fix and a self-check |
| Phone | nothing per fix | `watchdog.fix` FYI (batched per pass or one per fix) and `watchdog.gave-up` alert, through axf.notify@1 to AmberX, with build, cause, action, attempt |
| Watchdog itself stops | nobody would know | systems check **Build watchdog** red after 3 min without a pass; Auto fix reinstalls the cron and runs a pass |

## What was built (phase 2)

- s4 `deploy/claude-headless.sh` records each run's end (`builds-live.mjs run-end`, `agent-slots.mjs run-end`); optional
  `pipeline.runEnd` on build-pipeline@1 (absent until a run ends: old records load unchanged).
- s5 `agent-slots.mjs alive <build>` (build-liveness@1 = a build-watchdog@1 probe) and `reap`.
- s6–s9 `apps/console-web/plugins/build-orchestrator/watchdog.mjs`: `scan` (dry run), `run` (recover under a per-build
  lock, re-read, cooldown; `setPipeline` gained `mutate` so the recovery lands in the same store write), retries and
  account moves (claude-workers `markLimit` + `route`), keep every slot filled (dispatcher tick under its lock).
- s10 cron `axf-watchdog` (every minute, flock; install.mjs / uninstall.mjs / deploy/install-console.sh; self-removing).
- s11 notify types `watchdog.fix` / `watchdog.gave-up`; `notified` on each record. `watchdog.fix` is pushed at
  **normal** priority, not low as the step text said: notify-control keeps `low` on the banner only, so a low FYI would
  never reach the phone.
- s12 systems check items **Build watchdog** and **Builds the watchdog gave up on** (Fix = Requeue, ask first).
- s13 Watchdog settings (Settings → Plugins → Build orchestrator → Watchdog), stored in the shared pipeline folder.
- s14 Watchdog tab and each build's Recoveries; s20 three layouts (stacked / cards / split) in UI Review.
- s15–s16 REST, MCP, CLI, voice, deep link (below). s17 unit tests, s18 end-to-end test, s19 docs, help, glossary.

Found and fixed along the way: after a kill the wrapper's tmux waits out its close countdown, and the dispatcher's
launch gate adopted that dead session as running again. A recovery now closes the leftover tmux session when no claude
is alive in it (the e2e test proves the relaunch).

## How each feature is reached

| Feature | Console | REST (`/api/plugins/build-orchestrator/…`) | MCP (plugin commands) | CLI | Voice / actions | Deep link |
|---|---|---|---|---|---|---|
| Status (last pass, running builds, fixes, gave up) | Build orchestrator → Watchdog | `GET watchdog/status` | `watchdog-status` | `axf watchdog status` | `watchdog.status` | `build-orchestrator.focus:watchdog` |
| Dry run | Watchdog tab (Marked running) | `GET watchdog/scan` | `watchdog-scan` | `axf watchdog scan` | — (read via status) | same |
| Run a pass | Run now | `POST watchdog/run {build?}` | `watchdog-run` | `axf watchdog run [--build id]` | `watchdog.run[:<build>]` | same |
| Requeue a gave-up build | Requeue (tab, systems check Fix) | `POST watchdog/requeue {builds?}` | `watchdog-requeue` | `axf watchdog requeue [id…]` | systems check Fix | `build-orchestrator.focus:watchdog?build=<id>` |
| Settings | Settings → Plugins → Build orchestrator → Watchdog | `GET/PUT watchdog/settings` | `watchdog-settings`, `watchdog-settings-set` | `axf watchdog settings` / `set key=value…` | `watchdog-settings-set` | `settings.open:build-orchestrator` |
| A build's recoveries | the build's expanded row → Recoveries | `GET builds/<id>/recoveries` | `build-recoveries` | `axf watchdog recoveries <id>` | — | `build-orchestrator.focus:watchdog?build=<id>` |

In the console container (`AXF_WATCHDOG_HOST=request`) scan shows the host's last scan and run asks the host's cron
for a pass (within a minute); on the host both run live.

## Checks run (all pass)

`check-build-watchdog` 401/401 · `builds-store verify` ok (985 records) · `check-builds-store` 45 · `check-build-pipeline`
154/154 · `plugin-lifecycle check build-orchestrator` clean (with this worktree's untracked session files aside) ·
`tracker --check` ok · `test-watchdog.mjs` 15 · `test-watchdog-e2e.sh` passed · `pipeline.test.mjs` 59 · `test.mjs` 35 ·
`test.py` 47 · notify-control `test.py` 133 · plugin-commands 71/71 · glossary `catalog.mjs --check` complete · help
coverage at the ratchet · check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control ok ·
`tsc --noEmit` (console-web) clean.

## Left for after the merge

- The cron goes live with the next console deploy (`deploy/install-console.sh` runs `watchdog.mjs install-cron`). Until
  then the systems check shows **Build watchdog** red ("hasn't run yet"); its Auto fix installs it through axHub `vps.run`.
- The first real pass will pick up the two builds the s6 scan found stuck on the VPS (`x.engine.dev`,
  `axf-data-postgres-real-tables-own`: no tmux, no claude) and retry them.
- UI Review: Brett picks the Watchdog layout (stacked / cards / split); the pick becomes `DEFAULT_WATCHDOG_LAYOUT`.
- `test-watchdog-e2e.sh` needs tmux and starts real (fake-claude) sessions, so it runs on the VPS, not in CI; the unit
  test runs in CI.
- Kotlin twin of build-watchdog@1: deferred (framework/spec/PORTING.md, s3).
