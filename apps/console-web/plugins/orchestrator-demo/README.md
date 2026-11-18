# Orchestrator demo (console plugin)

`ai.amberx.axf.console.orchestrator-demo` · built on Opus · build `guided-live-demo-test-watch-orchestrator`.

Brett, Nov 17 2026: "I want to watch these grids in real time. I want to watch it die, fail, and show what failed. I
want to see it cross off steps as it goes. […] Give it at least 30 seconds between each thing. Give me an overlay
before it starts with a button to continue or pause. If I have pause between steps on, bring me to the focus of what I
need to see and wait until I click next, then another 30 seconds, and bring me to focus again."

A guided live tour of the Build orchestrator on the running console. It plays a demo-run@1
(`framework/spec/LIVE-DEMO.md`, reference core `framework/core/live-demo.mjs`) whose acts touch only throwaway
`demo-*` builds (demo-build@1 sandbox, `framework/core/demo-build.mjs`): the store refuses a demo write on any other
build, so a tour never queues, lands or notifies about a real one.

## What it shows

1. **Start overlay**: what the demo will do, Continue / Pause, a *Pause between steps* switch, Stop.
2. For every act: the console is focused on the thing to watch (console_open + highlight), a caption says what is
   about to happen, the act runs, the result is crossed off (pass / fail with what failed / skipped).
3. At least **30 s** between acts in both modes (the core never shortens it). With *Pause between steps* on it waits
   for **Next**, then 30 s, then focuses again.
4. **Summary**: a grid of acts with pass / fail and evidence links, Run again.

Acts (`acts/*.mjs`, demo-act@1): queue → launch → steps ticked one by one → running animation; a deliberate crash of
the fake session → watchdog → retry to the Queue; red CI on a demo branch → auto-fix → merge-main → the lander self-test → the real landing (the demo PR through the real merge queue); a
build that dies for good (red row + break alert) → stale-row cleanup → demo phone notification (`notify.json`).

No Claude account is spent: sessions are `fake-runner.sh`. Red CI, the fix and merge-main go through the dry-run lander (the real auto-lander decisions, recorded only). The landing is real since Nov 18 2026 (Brett: "If it recorded the test of the pipeline and didn't merge it on its own, then the test failed."): first the lander self-test (`selftest.mjs`, demo-selftest@1: the live gate verdict, the review lookup in the console, the merge queue in check mode; a failure stops the demo and raises the `demo-selftest` systems check item), then the demo PR (`demo/<build>`, one line in `_claude/builds/demo/landings.md`) is opened and put in the real merge queue (`real-landing.mjs`) and the act passes only once the queue merged it. `axf demo selftest`, `POST /api/plugins/orchestrator-demo/selftest`, MCP `orchestrator-demo_selftest`, voice "run the demo self-test".

## Reach it (all four the same)

| | |
|---|---|
| Deep link | `?axf-open=orchestrator-demo`, console-control `view:orchestrator-demo` |
| REST | `/api/plugins/orchestrator-demo/` `GET state`, `POST start {pause}`, `pause`, `resume`, `next`, `stop`, `PUT settings`, `GET summary` |
| MCP | the plugin-commands tools generated from those routes, and console actions `demo.*` |
| CLI | `axf demo orchestrator start [--pause] \| pause \| resume \| next \| stop \| state \| summary` |
| Voice | "start the orchestrator demo", "next", "pause the demo", "stop the demo" |

## Lifecycle

Data only in `.axf-console/plugins/orchestrator-demo/` (run records demo-run@1, fixtures). Settings → Plugins →
Orchestrator demo. `install.mjs` / `uninstall.mjs [--data | --all]`; `node framework/cli/plugin-lifecycle.mjs check
orchestrator-demo --after-uninstall`. Doc lines outside this folder end with `<!-- axf-plugin:orchestrator-demo -->`.
