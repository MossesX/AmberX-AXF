# Rebuild differences: both watchdogs in one build (fable-rebuild-2-2-both-watchdogs-one)

Fable, Nov 21 2026. Replaces the two separate watchdogs in the Build orchestrator plugin: the server watchdog
(PR #772, `recovery-watchdog.mjs`, build-watchdog@1) and the stale-row watchdog (PR #780, `watchdog.mjs`, stale-row@1).
Build report: `_claude/builds/reports/fable-rebuild-2-2-both-watchdogs-one.md`.

## Before and after

| | Before | After |
|---|---|---|
| Entry points | `recovery-watchdog.mjs` and `watchdog.mjs`, unrelated CLIs | one `watchdog.mjs`; the two are watches in `watchdog/` |
| Crons | `axf-stale-watchdog` (5 min); `axf-watchdog` retired, so nothing ran the session recovery | one `axf-build-watchdog` (1 min), each watch on its own interval |
| Stuck statuses | nobody: 22 builds stood in landing / fixing for up to 4 days | the `stale` watch pushes them along the done-means-merged line |
| Settings | two files, two routes, two settings sections | one flat map (`enabled`, `alerts`, `<watch>.<key>`), one section |
| What was caught | recoveries on builds + `build-watchdog.json`; a Cleanups log | one caught log for every watch, plus each watch's own records |
| Alerts | per watchdog; the `watchdog.fix` / `watchdog.gave-up` notify types were missing | one path; `watchdog.caught`, `watchdog.fix`, `watchdog.gave-up` declared |
| Health | two items (session passes, row runs) | those two, plus **Build watchdog runs** over the one cron and every watch |
| Adding a watch | a new file, cron, routes, settings screen | export `WATCH` (or `register()`); settings, view, API and alerts follow |

## Removed

- `recovery-watchdog.mjs` and the old `watchdog.mjs` as top-level files (moved, see Changed).
- The `axf-stale-watchdog` cron and its template `deploy/cron/axf-stale-watchdog`.
- The session watch's own cron text (`flock /run/axf-watchdog.lock … recovery-watchdog.mjs cron`).
- The settings section "Recovery watchdog" (`build-orchestrator.recovery-watchdog`).
- Slot filling by default in the session watch (now behind `sessions.fillSlots`).

## Kept

- build-watchdog@1 (decision table, fixture, `recoveries[]`, journal action `watchdog-recover`) and stale-row@1
  (classifier, fixture, Cleanups log): untouched.
- Every old route and command: `watchdog/*`, `recovery-watchdog/*`, MCP `watchdog-*` / `recovery-watchdog-*`, voice
  `watchdog.status`, `watchdog.run`, `orchestrator.watchdog.*`, the deep link `build-orchestrator.focus:watchdog`.
- Each watch's settings file and state file, where they were. No data migration.
- The two existing systems check items and "Builds the watchdog gave up on".

## Changed

- `recovery-watchdog.mjs` → `watchdog/sessions.mjs`; old `watchdog.mjs` → `watchdog/rows.mjs`. Both still run as their
  own CLI and are reachable as `watchdog.mjs sessions …` / `watchdog.mjs rows …`.
- `plugin.json` `cli`: `watchdog` → `watchdog.mjs` (new), `recovery-watchdog` → `watchdog/sessions.mjs`.
- `watchdog/cron.mjs` installs `axf-build-watchdog` and removes `axf-stale-watchdog`; `sessions.mjs install-cron` and
  the session health item's Auto fix now write that same one cron.
- Voice `watchdog.status` / `watchdog.run` call the one watchdog (`watchdog.run:<build>` runs every watch for it).
- The settings sections "Watchdog status" and "Watchdog" are now the detail views "Watchdog: build sessions live" and
  "Watchdog: left-over rows, runs and cleanups log" under the new "Watchdog" panel.

## Added

- `watchdog.mjs` (build-watchdogs@1): `WATCH_FILES`, `register`, `pass`, `scan`, `cronPass`, `requestPass`, `status`,
  `caught`, `allSettings`, `setSettings`, `alertsFor`.
- `watchdog/stale-core.mjs` + `watchdog/stale.mjs` (stale-status@1): the stale-status watch.
- `server/watchdogs.py`: routes `watchdogs`, `watchdogs/caught`, `watchdogs/scan`, `watchdogs/run`,
  `watchdogs/settings`; systems check item `build-watchdogs`.
- `web/Watchdogs.tsx`: the one panel, actions `watchdogs.*`, console-control targets.
- Six MCP commands `watchdogs-*`; three notify types; five written help entries.
- Tests: `test/watchdogs.test.mjs` (22), `test/watchdogs-store.test.mjs` (8), `server/test_watchdogs.py` (19), all in CI.

## Contracts, API, assets, fixtures

- New frames: `build-watchdogs@1`, `watchdog-catch@1`, `watchdogs-state@1`, `watchdogs-status@1`, `watchdogs-pass@1`,
  `watchdogs-scan@1`, `watchdogs-settings@1`, `stale-status@1` (+ `-scan`, `-pass`, `-settings`, `-memory`).
- builds@1 fields the stale watch writes (all existing): `mergedAt`, `landed { pr, sha, mergedAt, ci, ciAt, ciRun }`,
  `failure`, `status`, `notes`. New value shape: `landed.ciRun` may be `commit@<sha>` or `main@<sha>`.
- Journal action `watchdog-stale` for its store writes.
- No asset types, no schema files, no framework/core engine, no fixtures changed. No Kotlin work; the gap is in
  `framework/spec/PORTING.md`.

## Migration and compatibility

- Nothing to migrate. The deploy from main installs the new cron and removes the old one
  (`deploy/install-console.sh`, the plugin's `install.mjs`).
- New files appear in the pipeline folder on first run: `watchdogs.json`, `watchdogs-caught.jsonl`,
  `watchdogs-settings.json`, `watchdogs-stale.json`, `watchdogs-stale-settings.json`. They go through data-store@1
  (`builds/pipeline/…`), so they follow the namespace's mode.
- The session watch keeps its saved `enabled: false` (set from the console Nov 21): turn it on with
  `axf watchdog set sessions.enabled=on`.
- Anything that called `node …/watchdog.mjs run --cron` (the old row cleaner) now calls the one watchdog's `run`;
  the row cleaner's own form is `node …/watchdog/rows.mjs run --cron`.

## Tests before and after

| | Before | After |
|---|---|---|
| Session watch | `test-watchdog.mjs` 15 | 15 (cron test now asserts the one cron line) |
| Row cleaner | `test/watchdog.test.mjs` 14 | 14 |
| The one watchdog + stale-status table | none | `test/watchdogs.test.mjs` 22 |
| Stale watch store writes | none | `test/watchdogs-store.test.mjs` 8 |
| Routes | none for either watchdog | `server/test_watchdogs.py` 19 |

## Known gaps

- `ladder` and `escalate` are covered through the decision table and fake appliers, not against a real launcher.
- `merging` is watched but no builds@1 writer sets it today; it is there for the flow that does.
- A `landing` build whose PR is open gets a `stalled` failure rather than a lander nudge: the builds@1 lander has no
  per-build tick to call.
- The panel has not been looked at in a browser; no screenshot was taken.
- `test-watchdog-e2e.sh` was not run here (tmux + fake claude).
- The stale watch reads CI for at most 20 merge commits per pass.
