# pipeline-bring-up-from-main

Hand build, Nov 23 2026. Brett: "I want to get this pipeline working so we don't have to do these hand builds anymore.
I want everything to start going through Plan Studio and through the orchestrator."

## 1. How main expects the pipeline to run (written before anything was changed)

Everything runs on the VPS host from `/opt/axf`. Nothing on main runs in a container, and main has no lease: the one
dispatcher is whoever holds the lock file `/run/axf-pipeline.lock`.

| Part | How main runs it | Installed by | State found (20:20 UTC) |
|---|---|---|---|
| Dispatcher (layer 1) | cron `/etc/cron.d/axf-orchestrator-tick`, every minute: `orchestrator.mjs tick` under `/run/axf-pipeline.lock`; heartbeat `<pipeline dir>/orchestrator-tick.json` | `deploy/watchdog/cron.mjs install` (called by `deploy/install-console.sh`) | Installed Nov 21, ticking every minute, heartbeat fresh |
| Watchdog layer 2 (Pipeline 2.0) | cron `axf-watchdog-l2`, every minute: `deploy/watchdog/layer2.mjs run` | same | Running, enabled |
| Watchdog layer 3 | systemd `axf-watchdog-l3.timer`, every 2 min | same | Running, "all alive" |
| Store audits | cron `axf-watchdog-audits`, :17 and :47 | same | Running (`verify` exits 1, see Left open) |
| Lander | systemd `axf-lander.timer`, every minute: `deploy/lander/run.mjs tick` | `axf_lander_install` (`framework/deploy/axf-deploy.sh`) | Running, enabled, "nothing to land" |
| Build watchdog (builds@1 rows, stale statuses, sessions) | cron `/etc/cron.d/axf-build-watchdog`, every minute | `deploy/install-console.sh` | Installed again by today's 18:48 deploy, on; the `sessions` watch is off |
| Reconciler | cron `axf-builds-reconcile`, every 10 min | `deploy/install-console.sh` | Running, but GitHub answers 401 (see Left open) |
| Host services | `axf-hostd` units (`axf-builds-live`, `axf-host-api`, …) | `deploy/install-host-services.sh` | All active |

So main's dispatcher, lander and watchdogs were already installed and running. The 18:48 UTC deploy put the build
watchdog cron back, which is why the morning's findings 2 and 3 no longer matched. The pipeline still moved nothing,
for three reasons:

1. **Two dispatchers.** The container `axf-molly` (image of Nov 18, branch `axf-molly-container-orchestrator-gate`,
   never landed) ran its own tick, lander, reconciler and lease every minute on the same builds store
   (`/opt/axf/_claude` is mounted into it). Its `/run` is its own, so it never shared the host's dispatcher lock. Its
   lease (`molly-lease@1`) exists only in that branch: nothing on main reads it. The "lander: on false" line was this
   container's old lander, not main's.
2. **The one active place was taken by a build that had given up.** `orchestrator-settings-collapsible-split` failed at
   attempt 5 on Nov 22. Its steps s1 and s7 were refused five times each within minutes with "already has a live
   session": a second launch of a step whose own session had just started. A build that failed while active keeps the
   active place, so the six builds behind it and every new plan waited for ever.
3. **Hand builds are invisible.** `vps.build_start` runs `deploy/claude-headless.sh` directly. No store record is made,
   so the lander (which lands store builds at `build-complete`) never sees them. That is why four green PRs sat today.

## 2. What was done on the VPS (Nov 23, UTC)

| Time | What |
|---|---|
| 20:20 | Host tick confirmed: heartbeat fresh, one tick a minute under `/run/axf-pipeline.lock`. |
| 20:20 | Stale dispatcher retired: `docker update --restart=no axf-molly`, `docker stop axf-molly`, `systemctl disable --now axf-molly-bridge.service`, unit file removed, `daemon-reload`. The unit file is kept at `/root/axf-rollback/axf-molly-bridge.service`; the container is stopped, not removed. |
| 20:21 | 16 failed `axf-adopt-*.scope` units cleared (`systemctl reset-failed 'axf-adopt-*.scope'`). |
| 20:22 | `orchestrator.mjs retry orchestrator-settings-collapsible-split`, with the reason on the build. The tick launched s1 (20:23) and s7 (20:24) by itself. |
| 20:26 | Open steps ticked (`orchestrator.mjs act step`) on the seven shipped builds whose PR is merged, then each moved to `landing` through the guard (`builds-store.mjs set-status <build> landing`). |
| 20:38 | s7 had ended cleanly at 20:28 but was failed as "session gone" and refused five times by its own stale lock (the bug in section 4). Lock released (`build-lock.mjs release`), step recorded as completed (`builds-store.mjs flow … completed --step s7 --reset`, reason on the step). |
| 20:39 | The build went `build-complete` and the lander took it, by itself. |
| 20:40 | The lander stopped on `…--s10 is not on GitHub`: that step had committed nothing. Its empty branch was pushed so the landing could go on (the lander fix is in the PR). |
| 20:44 | Proof plan sent from Plan Studio 2.0 (section 9). |

## 3. What runs now, and from where

- **One dispatcher**: cron `axf-orchestrator-tick` → `/opt/axf/apps/console-web/plugins/build-orchestrator/orchestrator.mjs tick`. Nothing else ticks.
- **Lander**: `axf-lander.timer` → `/opt/axf/deploy/lander/run.mjs tick`. On.
- **Watchdogs**: `axf-watchdog-l2` (cron), `axf-watchdog-l3.timer`, `axf-build-watchdog` (cron). On.
- **Reconciler**: cron `axf-builds-reconcile`. Reads GitHub again (the 401 lines in its log are from before today's deploy).
- **Retired**: container `axf-molly` (stopped, restart policy `no`), `axf-molly-bridge.service` (gone).

## 4. Found while it ran, fixed in PR #897

1. **A finished step was failed as "session gone".** A step's exit is recorded by a detached call that waits for the dispatcher's lock and gives up after 2 minutes. s7's session ended with exit 0 at 20:28:10 and no exit was ever recorded for it (s1's, which ended 90 seconds later, was recorded at 20:32), so the call most likely timed out behind the tick, which holds that lock for much of every minute. The layer-2 watchdog then failed the finished step. Every relaunch was refused by the build lock the ended session had left, and five refusals used up the attempts in four minutes. This is what stopped `orchestrator-settings-collapsible-split` on Nov 22 and again today. Fix: the watchdog reads the session-end event (exit 0 = completed, no attempt spent), it releases a dead step's lock, and the exit call waits 15 minutes.
2. **One empty step stopped a ten-step landing.** A step branch that was never pushed failed `merging-pr` for the whole build. Fix: a branch with no commit is left out, one with unpushed commits is pushed by the lander.
3. **Failed `axf-adopt` scopes.** The build-limit enforcer moves stray build processes into a systemd scope. When the process ended in between, the scope failed with result `resources` and stayed. Fix: new scopes are collected when they end or fail.

## 5. Also in PR #897

- **Hand builds get a record.** `deploy/claude-headless.sh` files one when a hand session starts in a worktree on `claude/<its name>` (`framework/cli/hand-build.mjs`). It shows on the board, `builds-live.mjs link` works on it, and when the session ends cleanly the lander lands it like any other build. It never takes or waits for the one active place.
- **Budgets are enforced** by the dispatcher's tick (`framework/cli/build-budget.mjs`). A build at "Budget per build", and every running build once the day reaches "Daily budget", is stopped and Brett gets one alert naming the setting.
- Tests: hand-build records and budget stops (61 checks), the lander landing a hand build on green CI (6), the watchdog's clean-exit rule (7), the budget engine against a fixture.

## 6. Waiting on Brett's own click

- **Set the budgets.** Settings → Claude settings → Builds → **Budget per build (USD)** and **Daily budget (USD)**. No number was ever saved; the screen showed 15 and 60, which no code read. Real builds here cost 60 to 420 USD each and today's sessions cost about 140 USD, so enforcing 15 and 60 would have stopped every build. Both now default to 0 = no cap, and the first number saved is enforced from the next tick. Raising a cap is owner-only, so I did not pick numbers.
- **Two of the nine "shipped" builds are not on main.** `pass-approval-hook-deep-link-amberx-notification` (PR #681) and `context-menus-plugin-one-true-source` (PR #659) carry a shipped manifest, but their PRs are open and their branches are 19 and 31 commits ahead of main. They were left as they are: land or close the PRs.
- **The session watch of the build watchdog is off** (`sessions.enabled`, switched off from the console on Nov 21). It only covers old builds@1 builds; Pipeline 2.0 builds are covered by layer 2. Left as set. To turn it on: `axf watchdog set sessions.enabled=on`.

## 7. Left open

- Six builds wait their turn behind the active one (`group-chat-audio-hear-agents-talk-while`, `attach-widgets-to-any-toolbar-banner`, `rebuild-fresh-main-hide-any-asset`, `fix-refreshing-console-jumps-back`, `approval-pass-covers-every-call`, `one-build-time-always-split-to-fill`). The pipeline will now build and land them one at a time, on its own. To hold one: Build orchestrator → the build → Hold, or `pipeline2.mjs act <build> hold`.
- About 70 older builds@1 builds read Failed with their attempts used up (the layer-2 watchdog counts 75 "gave up already"). Not touched.
- `axf-watchdog-audits`: `builds-store.mjs verify` exits 1 on every run. Not looked into.
- The reconciler's log line "fetch origin/main failed: not a git repository" comes from its live-status read. Publishing itself works (`axf-builds-live` service).
- `deploy/claude-login.test.mjs` fails on this host on main as well.
- Catalog status and tracker rows were not written here: build rules give those to the VPS.

## 8. How to roll back

Bring the old dispatcher back (only if the host tick is stopped first: never two):

```
cp /root/axf-rollback/axf-molly-bridge.service /etc/systemd/system/axf-molly-bridge.service
systemctl daemon-reload && systemctl enable --now axf-molly-bridge.service
docker update --restart=unless-stopped axf-molly && docker start axf-molly
```

The bridge unit points at `/root/axf-builds/axf-molly-container-orchestrator-gate`, which no longer exists, so it cannot launch anything until that checkout is restored. Stop the host tick with `rm /etc/cron.d/axf-orchestrator-tick` (the deploy and watchdog layer 3 put it back: `node deploy/watchdog/cron.mjs install`).

Code: revert PR #897. Hand-build records already filed stay valid Pipeline 2.0 builds. With the PR reverted nothing enforces a budget, as before.
