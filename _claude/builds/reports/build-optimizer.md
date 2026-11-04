# Build optimizer (build-optimizer)

**Model:** Opus 5.5 (high thinking) · **Branch:** `claude/build-optimizer` (stacked on `claude/fable-packager`, PR #336) · **Date:** Nov 4 2026

## What Brett said (verbatim, Nov 4 2026, voice)

> In Build manager, add a button to optimize builds, which will take all the steps and sort them all into a smaller amount of builds, just moving all the steps over and combining builds. Yeah. And optimize, it will create a new package of builds, and it will list them all in a dialog to confirm. It will list the build with all of its steps.

Addenda 1–5 (drag steps anywhere; works without AI; Deep mode with AI; notifications; settings and filters) are on the build's origin (`build-origin.mjs get build-optimizer`).

## What was built

- **Shared combining code.** `web/optimizer-core.mjs` (build-optimize@1) sits on fable-packager's `web/packager-core.mjs`, so candidates, estimates, areas and dependencies are written once. The branch is stacked on #336 so both builds use the same code.
- **Planner (Basic, plain code, zero tokens):**
  - Scope comes from the packager candidates, so the step a running build is on never moves. Pins are respected. A setting decides whether unstarted steps of running builds can be pulled. 14 filters narrow the scope.
  - Fable and Opus steps go in separate builds, and so do profiles and urgent work. The weighted rules group by area, app, category and dependency chain.
  - A cap limits combining only: a build is never split.
  - Targets: Fewest, Balanced or Fastest.
  - Builds are ordered so dependencies run first and two builds claiming the same area run in turn.
  - Builds are named from the template. Duplicate and already-built steps are flagged; routine wrap-up steps and boilerplate are not.
  - Savings are estimated.
- **Store (one transaction, one undo).** These are in `framework/plan/builds-store-core.mjs`:
  - `applyOptimize`: new builds, steps moved with their uid kept and `origin.how = optimized`, Brett's verbatim words carried over, emptied builds archived or deleted, and a run record with pre-images.
  - `undoOptimize`: refused once work has started.
  - `moveSteps`: drag and drop between builds, with the drop position kept and running steps refused.
  - The `optimized` field and `meta.optimize` runs are preserved by the normalizer.
- **CLI.** `optimizer.mjs`: plan, evidence, refine, apply, undo, runs, move, settings and presets.
- **Server and MCP.** Routes `/optimize/plan|state|apply|undo|move|settings`, six plugin commands (MCP `build_orchestrator_optimize*`), owner-only on the primary.
  - Deep mode calls `axf.llm@1` with a timeout and a token-budget gate, and shows its estimate first.
  - Any failure falls back to Basic silently.
  - Deep runs are booked to the agent (default Patches).
  - Notifications follow the setting: a bell alert plus web push / ntfy, and a banner chip on the web side.
  - Schedule: manual, after a new build, or nightly. A scheduled run only plans and never applies.
- **Web:**
  - The **Optimize builds…** button sits in `builds.toolbar` (Build manager, orchestrator, pending, queue), the Builds menu and right-click on the build lists. Voice actions: `build-orchestrator.optimize[:mode|preset]` and `optimize-fable`.
  - The confirm dialog shows the mode, preset and notifications line, the filters, and the token estimate before a Deep run. Each new build is listed with all its steps (source build + step, flags, reasoning). In the dialog you can rename, accept an AI name, drag between builds or into a new one, multi-pick and untick. Then Apply / Cancel, and Undo after.
  - Drag steps between builds anywhere on the orchestrator page and across tabs and windows: payload `application/x-axf-build-steps` (build-steps@1), multi-pick by shift/ctrl-clicking grips, "move prerequisites too?", and every window reloads through a BroadcastChannel.
  - Settings → Plugins → **Build optimizer**: every setting from addendum 5, with presets you can save.
- **Docs.** `apps/console-web/plugins/build-orchestrator/OPTIMIZER.md`.

## Tests

| Check | Before | After |
|---|---|---|
| `node apps/console-web/plugins/build-orchestrator/test.mjs` | 40 | 49 (scope + running/pinned, area claims, Fable/Opus apart, caps, dependency order + prerequisites, apply → undo restores exactly, undo refused after work, move + undo, AI answers validated, locked settings, notifications) |
| `python3 apps/console-web/plugins/build-orchestrator/test.py` | 17 | 28 (no AI → Basic + notify, Deep with a fake AI, token estimate, AI error / junk / over budget → Basic, Every run, schedule) |
| console typecheck, check-theme, check-controls, check-toolbars, help-coverage, plugin-commands, menu-reach, test_mcp_tools, check-builds-store, check-build-origin | pass | pass |

On a copy of the real store, Basic turns **23 builds into 10** (77 steps, ~3 h of build overhead saved) in about 0.3 s. The apply → undo round trip gives back exactly the same store.

## Screenshots

`_claude/builds/reports/build-optimizer/shots/` (desktop 1440, phone 412; real store data with AI mocked as unavailable): the dialog open, the plan with the fallback notice, the steps with their reasoning, the filters, and the settings page. Sent to UI Review as non-blocking.

## Known gaps

- `builds-store.mjs verify` lists archived builds as "status pending kept (now archived)" against the old read-only exports. It does the same for any archive, and it isn't a store error.
- Phone delivery uses the alert hub's web push / ntfy channels. AmberX receives those wherever it is subscribed.
- Pins: the store has no `pinned` field, so pins live in the optimizer settings (`pins`). A `pinned: true` on a build or step is honoured as well.
- Android twin deferred (Android on hold). The core is pure JS, ready to port.
