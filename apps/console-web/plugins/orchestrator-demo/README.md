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
the fake session → watchdog → retry to the Queue; red CI on a demo branch → auto-fix → merge-main → dry-run landing; a
build that dies for good (red row + break alert) → stale-row cleanup → demo phone notification (`notify.json`).

No Claude account is spent: sessions are `fake-runner.sh`; landing goes through a dry-run lander, never the merge queue.

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
