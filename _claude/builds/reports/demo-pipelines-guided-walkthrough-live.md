# Demo pipelines: guided walkthrough with live behind-the-scenes output

Build `demo-pipelines-guided-walkthrough-live`, phase 1 (Opus), branch `claude/demo-pipelines-guided-walkthrough-live`.

## Brett said (verbatim)

> a bunch of different types of pipelines for demonstration purposes, walked through so you can see what's going on
> behind the scenes; follow the console building stuff, and a terminal or scrolling window showing all the output you
> wouldn't normally see

## What was built

The Demonstration Designer plugin (`apps/console-web/plugins/demonstration-designer/`) gets a second mode,
**Pipelines**, beside Pitch (a TabGroup on its page). Everything lives in the plugin folder.

| step | what |
| --- | --- |
| s1 | Pitch / Pipelines mode row on the designer page; `pipelines.mjs` (pipeline-demo@1: chapters, timeline, a pure player, panel filter, voice match, probe lines, deep link) |
| s2 | `pipeline-library.mjs`: seven built-in demos, one per type: voice to app, add a feature, skin swap, parallel split build, fix a failing build, new project from a template, approval flow (veto, approve by voice) |
| s3 | `web/cover.tsx` in slot `app.frame.cover`: the walkthrough bar (chapter title and narration, spoken unless muted, chapter numbers to jump to, back / play-pause / skip / restart / speed / stop). Focus mode: each chapter moves the console to its screen (orchestrator, builds and steps, UI Review, Shipped features…) and scrolls to its element |
| s4 | `web/bts.tsx`: behind-the-scenes terminal streaming orchestrator, model picks, step splits, agent log, git, tests, axHub, focus and error lines, one colour token per kind, filter by kind and words, dock / float (resizable) / full screen, sticks to the newest line, Copy |
| s5 | `pipeline-demos.mjs`: replay (the recording of the last live run, else the script; offline, instant) or live (each chapter's read-only probes run for real on the test-sandbox project and this checkout: git log and status, the sandbox builds, model policy on the chapter's words, the rules split, the plugin self-test, check-theme, agent-slots status, and a dry-run axHub payload that is printed and never sent). Output kept as pipeline-recording@1. Speed 0.5× to 4×, pause, restart |
| s6 | `web/pipelines.tsx` designer: New demo or Edit a copy of a built-in; type, name, voice phrases, and per chapter narration, screen, element, seconds, behind-the-scenes lines (`@seconds kind: text`), live probes |
| s7 | REST routes (14) declared as plugin commands (so MCP tools `demonstration_designer_pipeline_*` and `axf demonstration-designer pipeline-…`), 17 console actions `pipeline.*` (voice through AmberX, `console_action` over MCP) in the control inventory, deep link `?axf-pipeline=<id>[&axf-autoplay=1][&axf-mode=live]`, `GET pipeline/state` (the open console reports its player), help entries, README section, PORTING gap |
| s8 | Brett's ask end to end: `pipelines.e2e.mjs` (Playwright on the built console) plays a demo, checks the walkthrough follows the chapters, the panel streams, filters, floats and goes full screen; desktop and phone shots |
| s9 | this report, THREADS row, PR |

## How each thing is reached

See the README table "Pipelines mode". In short:
- **Deep link**: `?axf-pipeline=<id>` (opens), `&axf-autoplay=1` (plays), `&axf-mode=live`; `?axf-pipeline=library`.
- **REST**: `/api/plugins/demonstration-designer/pipelines`, `pipeline`, `pipeline/copy`, `pipeline/timeline`, `pipeline/lines`, `pipeline/live`, `pipeline/recording`, `pipeline/match`, `pipeline/link`, `pipeline/types`, `pipeline/state`.
- **MCP / CLI**: the same as plugin commands (`demonstration_designer_pipeline_live`, `axf demonstration-designer pipeline-lines --id parallel-split --kind git`), plus `node …/pipeline-demos.mjs` without the console.
- **Voice / console actions**: "run the voice-to-app demo" → `pipeline.run:voice-to-app`; `pipeline.live`, `.replay`, `.pause`, `.resume`, `.next`, `.prev`, `.chapter:<n>`, `.restart`, `.speed:<x>`, `.mode`, `.dock:<dock|float|full>`, `.panel:<on|off>`, `.filter:<kinds>:<words>`, `.follow`, `.stop`, `.open`.

## Tests

- `node apps/console-web/plugins/demonstration-designer/test.mjs`: 31 checks (9 new: library, timeline, player, filter, voice, deep link, designer store, a real live run on test-sandbox, the pipeline CLI).
- `python3 apps/console-web/plugins/demonstration-designer/server_test.py`: 26 checks (16 new pipeline routes).
- `pipelines.e2e.mjs`: see the e2e line below.
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, plugin-lifecycle check: pass. `tsc --noEmit`: pass.

## Decisions taken without asking

- Built into the existing Demonstration Designer rather than a new plugin: s1 names it, and the pitch stage and the pipelines player share the page, the data folder and the settings tab.
- "Runs for real in the test-sandbox project" is read-only on purpose: a live run reads the sandbox builds and the checkout and runs checks, but never creates a build, a commit or a hub record (those would reach main through builds-live, and axHub calls need Brett's approval). The axHub line is the payload a chapter would send, printed.
- The player runs in the open console, so player moves are console actions (like the pitch stage's); REST reads the reported state.
- No new feature-catalog item: the catalog is generated from the checklist; Shipped features gets this build from the shipped manifest when it lands.

## Open

- UI Review: desktop and phone shots submitted (see PR).
- Android twin deferred (PORTING.md).
