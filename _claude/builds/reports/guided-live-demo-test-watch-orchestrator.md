# Guided live demo: watch the orchestrator do everything in real time

Build `guided-live-demo-test-watch-orchestrator` · branch `claude/guided-live-demo-test-watch-orchestrator` · PR #816 ·
Fable (contracts, s1–s3) then Opus (s4–s24).

Brett, Nov 17 2026: "I want to watch these grids in real time. I want to watch it die, fail, and show what failed. I
want to see it cross off steps as it goes. Make a test so I can watch it in real time everything it can possibly do.
Give it at least 30 seconds between each thing. Give me an overlay before it starts with a button to continue or
pause. If I have pause between steps on, bring me to the focus of what I need to see and wait until I click next,
then another 30 seconds, and bring me to focus again."

## Result

- New console plugin **Orchestrator demo** (`apps/console-web/plugins/orchestrator-demo`). A start overlay, a live
  caption bar that follows what to watch, a page with the act list crossed off as it goes, and a summary.
- **21 acts in 4 parts**, all against throwaway `demo-*` builds:
  1. queue → launch → steps s1–s4 crossed off one at a time → the running animation;
  2. a second build runs → its fake session is killed → the watchdog catches it → retry back to the Queue;
  3. red CI on a demo branch → auto-fix filed → merge-main → landing through a dry-run lander (never the merge queue);
  4. a build fails every retry → dies for good (red row) → break alert and dialog → stale-row cleanup → a demo
     phone notification (`notify.json`, type `orchestrator-demo.demo`).
- **At least 30 s between acts in both modes.** The core (`framework/core/live-demo.mjs`) refuses anything shorter.
  With *Pause between steps* on, it stays on the act until **Next**, then waits 30 s, then focuses the next act.
- **No Claude account is spent.** Sessions are `fake-runner.sh`; landing is the dry-run lander.
- **Stop** ends the run at once and removes every demo build, branch and alert. The summary (pass / fail / skipped per
  act, what failed, evidence) is kept in the run record. A console restart picks a run back up.
- **Dependency check:** the demo won't start until the live build status build (`live-build-status-real-time-grids-15`,
  9/22 steps, pending) has landed its real-time grids, break alert and broke dialog. The overlay lists what's missing
  in plain words. Today all 5 parts are missing, so **Start refuses on the live console until that build lands**.

## How each part is reached (all the same)

| What | Deep link / console | REST `/api/plugins/orchestrator-demo/…` | MCP (plugin-commands) | CLI | Voice (AmberX) |
|---|---|---|---|---|---|
| Start overlay | `?axf-open=orchestrator-demo`, `dialog:orchestrator-demo.start`, action `orchestrator-demo.open` | `POST open {pause?}` | `orchestrator-demo_open` | `axf demo orchestrator open` | — |
| Start | Continue in the overlay, action `demo.start[:pause\|no-pause]` | `POST start {pause}` | `orchestrator-demo_start` | `axf demo orchestrator start [--pause]` | "start the orchestrator demo", "start the demo step by step" |
| Pause / resume | caption bar | `POST pause`, `POST resume` | `orchestrator-demo_pause`, `_resume` | `… pause`, `… resume` | "pause the demo", "resume the demo" |
| Next | caption bar | `POST next` | `orchestrator-demo_next` | `… next` | "next", "next act" |
| Skip | caption bar | `POST skip {why?}` | `orchestrator-demo_skip` | `… skip [--why]` | — |
| Stop + cleanup | caption bar, overlay | `POST stop {why?}` | `orchestrator-demo_stop` | `… stop` | "stop the demo" |
| Pause between steps | overlay switch; Settings → Plugins → Orchestrator demo | `PUT pause-between-steps {pause}` | `orchestrator-demo_pause_between_steps` | `… pause-between-steps on\|off` | — |
| State (n/N, countdown, check-list) | page `view:orchestrator-demo` (`?axf-open=orchestrator-demo:page`) | `GET state` | `orchestrator-demo_state` | `… state` | "where is the demo" |
| Summary | dialog `orchestrator-demo.summary` (`?axf-open=orchestrator-demo:summary`) | `GET summary` | `orchestrator-demo_summary` | `… summary` | — |
| Settings | `?axf-open=orchestrator-demo:settings` | `GET settings` | `orchestrator-demo_settings` | `… settings` | — |
| Dependency check | listed in the overlay | `GET deps` | `orchestrator-demo_deps` | `… deps` | — |

Console actions: `demo.start`, `demo.pause`, `demo.resume`, `demo.next`, `demo.stop`, `demo.state` (`actions.json`).
Voice phrases: `voice.json`. Every route goes through `runner.mjs`, the one place the run is read and changed.

## Tests

| Test | Result |
|---|---|
| `node --test apps/console-web/plugins/orchestrator-demo/test.mjs` (core vs fixture, catalog, 30 s gap in both modes, Next → 30 s → focus, sandbox guard, a real build named demo-* is safe, stop cleanup, settings, deps, CLI) | 12/12 pass |
| `python apps/console-web/plugins/orchestrator-demo/server/test.py` (every route, refusals and codes, stop cleans up, real build untouched) | 22/22 pass |
| `node framework/spec/check-live-demo.mjs` | 419/419 |
| Dry run `test-e2e.mjs --gap 300` on a copy of the real builds store, auto mode | 21/21 acts pass, 1022 real builds unchanged (4 named demo-*), 56 s ([dry-run.json](guided-live-demo-test-watch-orchestrator/dry-run.json)) |
| Same with `--pause` (Next pressed on every act) | 21/21 acts pass ([dry-run-pause.json](guided-live-demo-test-watch-orchestrator/dry-run-pause.json)) |
| `builds-store verify` | ok, 30562 checks |
| check-theme, check-controls, check-toolbars, check-console-control, check-chrome-assets, plugin-commands check, plugin-lifecycle `--after-uninstall` (scratch worktree), help coverage, check-help, glossary `--check`, notify-control test, console-web `tsc` | all pass |

## Found and fixed on the way

- **Real builds named `demo-*`.** The first dry run's cleanup soft-deleted four real builds whose ids happen to start with
  `demo-` (`demo-sandbox-system-sandbox-settings-panel`, `demo-designer-finish-phase-2-s2-s3-resuming-from`,
  `demo-pipelines-guided-walkthrough-live`, `demo-video-series-three-minute-browser`). That was on the test copy; the
  real store was never touched. The demo now only removes or changes its own fixtures (`demo-<grid|crash|ci|die>-<suffix>`
  **and** `source: orchestrator-demo`), and a unit test pins it.
  **Open gap (framework, Fable contract):** demo-build@1 (`framework/core/demo-build.mjs`) still counts any `demo-*` id as
  a demo build (`builds-store verify` reports "4 demo"), so the store's own demo guard wouldn't protect those four from
  another demo writer. The fix is to require the tag (`demo: true`) and not the prefix alone. It's a contract change, so
  it's left for a Fable step.
- The store never drops a record (soft delete), so "row gone" now means gone or `deleted`.
- The test-only scaled clock is anchored on the run, so the driver and every REST/CLI event agree on the time (a Next
  from another process used to arrive "hours early" and was ignored).
- Glossary ratchet: main was 3 over. Fixed by fitting `builds-store.mjs`'s header back under the catalog's read window
  and describing four notify-control commands.

## UI Review

Item `r-20261117-qxltg01` "Orchestrator demo: start overlay, caption bar and summary" (6 shots + 3 overlay options:
Spotlight modal, Bottom sheet, Compact card; assets in `plugins/orchestrator-demo/assets/dialog/`). Shots:
[shots/](guided-live-demo-test-watch-orchestrator/shots/), made by `apps/console-web/plugins/orchestrator-demo/shots.mjs`.
**This session had no console token**, so the item was saved in the build worktree, not on the console. Post it with
`AXF_CONSOLE_URL=… AXF_TOKEN=… node apps/console-web/plugins/ui-review/review.mjs submit … --console --choices
_claude/builds/reports/guided-live-demo-test-watch-orchestrator/choices.json`.
The PR waits on UI Review.

## Files

`apps/console-web/plugins/orchestrator-demo/`: `plugin.json`, `runner.mjs` (demo-run@1 driver + CLI), `acts/*.mjs`
(the catalog), `sandbox.mjs` (fixtures), `fake-session.mjs` + `fake-runner.sh`, `dry-lander.mjs`, `cleanup.mjs`,
`deps.mjs`, `cli.mjs`, `server/routes.py`, `web/` (StartOverlay, CaptionBar, DemoView, SummaryDialog, Settings, api,
index), `actions.json`, `voice.json`, `notify.json`, `help.json`, `test.mjs`, `server/test.py`, `test-e2e.mjs`.
Core: `framework/core/live-demo.mjs`, `framework/core/demo-build.mjs`, `framework/spec/LIVE-DEMO.md`.
