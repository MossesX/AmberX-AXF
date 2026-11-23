# Pipeline 2.0 watchdog (pipeline-watchdog@2)

Three layers keep the pipeline moving with no human (Brett, Nov 18–19 2026: "absolutely no human intervention, ever").

This is the one watchdog for Pipeline 2.0 builds. It has no status rules of its own: the flows, who holds the active
place (`holdsActive`), the attempt ceiling, the step cap and every status change (`transition`) come from the contract,
`framework/core/pipeline-status.mjs`. The older watchdogs in the build orchestrator plugin (the builds@1 recovery
watchdog and the stale-row cleaner) skip Pipeline 2.0 builds.

| Layer | What | Schedule | File |
|---|---|---|---|
| 1 | The orchestrator tick does the normal work | cron `axf-orchestrator-tick`, every minute | the build orchestrator's `orchestrator.mjs tick` |
| 2 | Finds stuck work and fixes it | cron `axf-watchdog-l2`, every minute | `layer2.mjs run` (decisions: `core.mjs`) |
| 3 | Keeps layers 1 and 2 alive; alerts only when it can't heal | systemd `axf-watchdog-l3.timer`, every 2 min | `layer3.mjs run` |
| – | Store audits: `builds-store.mjs verify`, `model-gate.mjs audit`, `build-origin.mjs missing` | cron `axf-watchdog-audits`, :17 and :47 | `audits.mjs run` |

`cron.mjs install` writes every schedule (called by `deploy/install-console.sh` and the orchestrator plugin's installer)
and removes the retired `axf-pipeline`, `axf-auto-land` and `axf-watchdog` crons, so a deploy never brings them back.

## Layer 2: what it fixes

| Found | Fix |
|---|---|
| A build or step status past its time budget (`BUILD_BUDGET_MIN`, `STEP_BUDGET_MIN`) | Re-run the transition (the tick with `--build <id>`), up to `nudges` times, then mark it `failed` |
| A `building` step whose tmux session is gone after a clean exit (exit 0 in its session-end event; its exit call was lost) | `completed`, on the attempt it ran on; its build lock is released |
| A `building` step whose tmux session is gone | `failed` at `building`, its build lock released, then relaunched through `ready` as attempt N+1 |
| A `building` step whose log shows "You've hit your weekly limit" or any usage limit | Account marked out (`claude-workers.mjs markLimit`), session killed, `failed`, relaunched on the account with usage left as attempt N+1 |
| A `building` step past twice its estimate (the 15 minute cap when it has none) with a silent log | Session killed, `failed`, relaunched |
| A `failed` build or step under `maxAttempts` | Retried forward: back into the status it failed in (`failedFrom`), attempt N+1 |
| An Opus step that used up its attempts in its slot | Raised to Fable once, as a reset: a fresh attempt count, the reason in its log |
| Attempts used up (the lander's builds too) | Stays `failed`, ONE alert to Brett. Only a reset moves it on: `orchestrator.mjs retry <build>` |

Waiting is not stuck: a `split` build has no time budget at all while any build holds the active place, and a build
that failed while active still holds it (the contract's `holdsActive`; Nov 21 2026: four builds were failed and given up
on while they only waited behind a failed build). A `ready` step waits for a slot unless its build is the active one.
Two kinds of build are left alone on purpose: a hand build (`hand` on the record) until it reaches `build-complete`
(its session is started, and started again, by hand), and a build stopped at a budget cap (`budgetStop`) until the cap
allows it again.
`maxAttempts` may be lowered in the settings, never raised above the contract's ceiling (5).

Every action is a note on the build (`by: watchdog`) and a line in `<pipeline dir>/watchdog2/actions.jsonl`.

## Layer 3: what it heals

The cron daemon (restart), the schedules (reinstall), a stale layer-2 heartbeat (kill a hung pass, run one), a stale
orchestrator tick (kill a hung tick, run one). After three failed heals in a row: one alert with the exact steps,
re-sent at most every 6 hours. Layer 2 restarts the layer-3 timer when its heartbeat is over 10 minutes old.

## Audits

One at a time, `nice -n 19` + `ionice -c3`, skipped while an agent-slots heavy step runs or the load is over 0.7 per
core, and only from the main checkout (never a build worktree). The build rules that used to run them before every
dispatch (`one-builds-store`, `model-upgrade-approval`, `fable-auto-upgrade`, `build-origin-verbatim`) now name a
`watchdog:<audit>` checker; `audits.mjs handoff` makes that edit on the live rules store.

## Commands

```
node deploy/watchdog/layer2.mjs scan | run | status | settings | set key=value…
node deploy/watchdog/layer3.mjs check | run
node deploy/watchdog/audits.mjs run [--force] | status | handoff
node deploy/watchdog/cron.mjs install [--dir /opt/axf] | status | print | remove
node --test deploy/watchdog/*.test.mjs
```
