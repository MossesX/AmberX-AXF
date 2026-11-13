# Pending tab: one collapsed row per build, tap to expand everything

Build `pending-tab-one-collapsed-row-per-build` · Opus · Nov 12 2026.

Brett said: "No! Every building pending should have its own row that opens, that expands to show everything."

## What changed

- **Every pipeline tab** (Pending, Queue, Active, Incomplete, Complete, Errors, Archive, Deleted) is now a framework
  DataGrid: one compact row per build — select, title + id, next model, steps done/total, commits behind main, age,
  priority, flags (hold / your OK / split / account). Nothing inline by default (the old cards listed every step on
  Pending and Queue).
- **Tap a row** (or its chevron) to open it: the pipeline part (said, id, branch + behind main, PR, next step, minutes
  left, planned / taken account, wait reason, hold, deleted, Queue / Runs on / Split now / every build action) and the
  full build: origin (what Brett said), the step subgrid, detail, headless runs, notes, branch / PR and every command
  (add note, add step, edit, copy brief, hide, archive, remove). Opening a row reloads the orchestrator state so it is fresh.
- **All builds** tab: Behind column added to the grid; its List view cards are one line until "Open" is tapped.
  Expanded rows use the same `BuildDetail` as the pipeline tabs.
- **Phone**: priority, flags and age columns drop out; title, model, steps and behind stay on one line.
- **Behind main**: `pipeline.mjs` works it out with one `git for-each-ref --format=%(ahead-behind:origin/main)` over
  local + origin `claude/*` branches (~0.1 s for 900 branches); rows carry `behind` (null without a branch).
  `AXF_PIPELINE_BEHIND=off` skips it.
- DataGrid rows now carry `aria-expanded` when they can expand (state readable from the DOM).

## API (all four the same)

- Deep link: `build-orchestrator.tab:<tab>`, `build-orchestrator.open:<build>` / `build-orchestrator.focus:<build>`
  (opens the build's tab with its row open, as before).
- New console actions (REST console API, MCP console actions, voice): `build-orchestrator.expand:<build[,build…]|all>`
  and `build-orchestrator.collapse:<build[,build…]|all>`.
- State: `GET /api/plugins/build-orchestrator/pipeline` (rows now carry `behind`), `pipeline.mjs status --json` /
  `pipeline.mjs show <id> --json` on the CLI; full build via `GET …/state` / `orchestrator.mjs`.
- Every command in an open row was already an API call (`pipeline/queue|route|split|action`, `act`); unchanged.

## Checks

- `tsc --noEmit` (console-web) clean.
- `pipeline.test.mjs` 46 passed (new: rows carry `behind`; `behindMain` map shape and off switch);
  `test.mjs` 33 passed.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` pass.
- `plugin-lifecycle check build-orchestrator` reports stale references that predate this build
  (`framework/spec/check-build-limit.mjs`, untracked `.axf-*` files).

## Not done

- Screenshots for UI Review: `rebuild-shots.mjs` on a scratch console could not reach the orchestrator (axHub look
  needs `AXF_APPEARANCE_HUB=off`; then the orchestrator plugin's menu entries do not appear and the Pending builds page
  times out on screenshot). Desktop + phone shots still need taking on the live console.
- Build tables outside the orchestrator plugin (console Pending builds list, Plan Studio) were not touched: the brief
  limited the files to read; this build covers the orchestrator, which is the only place that manages builds.
