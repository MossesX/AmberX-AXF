# fable-rebuild-2-2-both-watchdogs-one: both watchdogs in one build

Branch `claude/fable-rebuild-2-2-both-watchdogs-one`. Fable, one session, four steps (s1 to s4), Nov 21 2026.
The brief: PRs #772 (server watchdog) and #780 (stale-row watchdog) both added a `watchdog.mjs` to the Build
orchestrator plugin; do it as one. Differences against what it replaces:
`_claude/memory/docs/rebuilds/fable-rebuild-2-2-both-watchdogs-one.md`.

## What shipped

- **One watchdog.** `apps/console-web/plugins/build-orchestrator/watchdog.mjs` (build-watchdogs@1) is the only entry:
  an open registry of watches, one pass, one caught log (`watchdog-catch@1`), one state file, one flat settings map,
  one alert path, one cron (`axf-build-watchdog`, every minute; `axf-stale-watchdog` is removed on install).
- **s1, the server watchdog** is the `sessions` watch (`watchdog/sessions.mjs`, was `recovery-watchdog.mjs`): builds
  marked running whose session is stuck, was killed or failed are reset and requeued, retried, moved to another
  account, or handed over past the retry cap. It no longer ticks the dispatcher unless `sessions.fillSlots` is on.
- **s2, the stale-status watch** is new (`watchdog/stale-core.mjs` pure, `watchdog/stale.mjs` IO, stale-status@1):
  builds standing in `landing`, `fixing` or `merging` past their limit are pushed to the next action on the
  done-means-merged line: the merge recorded, landed on green CI, a failure recorded, the retry ladder's next rung
  launched, or escalated. The row cleaner from #780 is the third watch, `rows` (`watchdog/rows.mjs`).
- **s3, settings, view, alerts.** Settings → Plugins → Build orchestrator → Watchdog is one panel (Caught, Watches,
  Settings drawn from the schema). REST `watchdogs/*`, MCP `watchdogs-*`, CLI `axf watchdog …`, voice `watchdogs.*`.
  Notify types `watchdog.caught`, `watchdog.fix`, `watchdog.gave-up`. Systems check item **Build watchdog runs**.
- **s4.** Tests, README, help entries, catalog status `cx.buildengine.watchdogs`, the PORTING gap, this report.

## How each thing is reached

| | Screen | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| Status | Watchdog panel header, Watches tab | `GET watchdogs` | `watchdogs-status` | `axf watchdog status` | `watchdogs.status` |
| What was caught | Caught tab | `GET watchdogs/caught` | `watchdogs-caught` | `axf watchdog caught` | `watchdogs.open:caught` |
| Dry run | Dry run buttons | `GET watchdogs/scan` | `watchdogs-scan` | `axf watchdog scan` | `watchdogs.scan` |
| Run now | Run now, Run this watch | `POST watchdogs/run` | `watchdogs-run` | `axf watchdog run` | `watchdogs.run` |
| Settings | Settings tab | `GET/PUT watchdogs/settings` | `watchdogs-settings`, `watchdogs-settings-set` | `axf watchdog settings`, `set key=value` | `watchdogs.set:<key>:<value>` |

Deep link: `build-orchestrator.focus:watchdog[?build=<id>]`. Console-control: `panel:build-orchestrator.watchdogs`,
`setting:orchestrator.watchdogs.<key>` (one per setting the server lists).

## Checks run

- `test/watchdogs.test.mjs` 22 passed (the stale-status table, a pass on fake sources, the host: registry, pass, caught
  log, alerts, settings, requests, status).
- `test/watchdogs-store.test.mjs` 8 passed (the stale watch's real writes on a scratch builds store).
- `server/test_watchdogs.py` 19 passed (routes, 400s, request mode, the systems check item).
- Existing suites still green: `test-watchdog.mjs` 15, `test/watchdog.test.mjs` 14, `test.mjs` 35, `toolbar.test.mjs`,
  `test/p2-status-contract.test.mjs` 53, `server/test_emergency.py` 23, `plugin-commands` 51,
  `node --test deploy/watchdog/`, `check-done-means-merged` 417, `check-build-watchdog` 401, `check-stale-rows` 32,
  `check-build-pipeline` 154, `check-json-data-writes`, `help-coverage --check`, `check-theme`, `check-controls`,
  `tsc --noEmit` on console-web, `bash -n deploy/install-console.sh`.
- Live, read-only: `watchdog/stale.mjs scan` against the real store and GitHub found 22 builds standing 17 hours to
  4 days (see below). Nothing was changed on the VPS from this branch.
- Not run: `test-watchdog-e2e.sh` (needs tmux and a fake claude through the dispatcher), a browser pass of the new
  panel (no screenshot taken), and the cron itself on the host (it is installed by the deploy from main).

## What it will do when it lands

The dry run on Nov 21 found 22 builds@1 builds standing still, none with an attempt on record:

- 2 merged PRs the build never heard of (#851, #867): the merge is recorded, CI read on the next pass.
- 1 merged with CI red on its own merge commit and main green since (#827): landed, with `landed.ciRun = main@<sha>`.
- 6 in `fixing` (red CI, failed push) for 3 to 4 days: the ladder's first rung, one launch per pass.
- 13 in `landing` for 3 to 4 days with their PR still open: a `stalled` failure each, then the ladder.

So it starts sessions: at most one per pass (every 10 minutes), longest-standing first. To hold that back:
`axf watchdog set stale.maxLaunchPerPass=0` (bookkeeping only) or `stale.enabled=off`.

## Judgement calls

- **Three watches, not two.** The step text for s2 describes status dwell; #780's watchdog cleaned rows whose PR
  merged. Both are kept: `stale` is the step as written, `rows` is #780's job, unchanged in behaviour.
- **Landed on a green main.** When CI on the merge commit itself is red, cancelled or missing but main is green now
  with the merge in it, the build is set landed and `landed.ciRun` names main's commit. The guard's letter is CI green
  on the merge commit; this reads it as "merged and main is green with it in". Without it the 4-day backlog could only
  be escalated. Say so if it should escalate instead: it is one branch in `stale-core.mjs` `decide`.
- **The session watch is off on the VPS today.** `build-watchdog-settings.json` has `enabled: false`, set from the
  console on Nov 21 13:54 UTC. This build does not flip a setting somebody made: the `sessions` watch stays off until
  `axf watchdog set sessions.enabled=on`. The systems check item says which watches are off.
- **`fillSlots` defaults off.** The old recovery cron was retired because its slot filling ran the old pipeline tick;
  the orchestrator tick fills slots every minute now.
- **Old routes and commands kept.** `watchdog/*` and `recovery-watchdog/*` still answer; the two old settings
  sections became detail views under the one Watchdog panel, and the separate Recovery watchdog settings section is
  gone (its settings are in the one map).
- **Pipeline 2.0 builds are not watched here.** `deploy/watchdog` stays their one watchdog.
- **No new framework/core engine.** The stale-status table is plugin-local, so no fixture and no baked copies; the
  Kotlin twin is recorded as a deferred gap in `framework/spec/PORTING.md`.

## After it went live (same day, follow-up PR)

PR #883 merged 21:17 UTC; the VPS deployed it and the first pass ran at 21:25: 26 builds watched, 3 caught (the
merges of #851 and #867 recorded, a `stalled` failure on the oldest landing build, PR #824), one alert. Reading that
first pass against the live state showed two things, fixed in a follow-up:

- **Main's CI still running.** A merged build whose own merge commit has red (or no) CI was failed or escalated
  whenever CI on main's newest commit had not finished, which is most of the time on a busy day. It now waits:
  main's result decides (green: landed; red: a `ci-red` failure). No build was failed by this before the fix: the one
  launch per pass had gone to the older build.
- **Heartbeat.** "Last pass" only moved when a watch was due, so with the row cleaner at 5 minutes the systems check
  item could flap red at the 5-minute limit. The cron now writes `lastTick` every minute and staleness is judged on it.
- The CLI's "cron installed, out of date" was wrong: the deploy script writes the schedule line alone, the plugin
  installer the whole template. Both now count as current.

## Queue clashes

Older rows for the same work, all Failed, superseded by this build (a note was added to each):
`server-watchdog-orchestrator-auto-recovers-stuck` (#772), `orchestrator-stale-row-watchdog-vps` (#780).
Left alone: `slot-watchdog` (Slot Warden, Pending, Opus): a crew member over agent slots, a different thing; it can
become a fourth watch through `register()`. `watchdog-plugin-owns-every-vps` (Failed): a separate plugin owning every
VPS automation; it would move these watches, not redo them.
