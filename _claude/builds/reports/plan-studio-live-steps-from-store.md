# plan-studio-live-steps-from-store

Hand build, one session (Fable), Nov 23 2026. Plan `plan-studio-live-progress-one-st-6z4z`. PR #894, branch
`claude/plan-studio-live-steps-from-store`. UI Review item `r-20261123-574336e4` (8 shots, desktop and phone).

## Result

Built. A plan sent from Plan Studio 2.0 now shows the orchestrator's real steps and checks them off live.

| # | Asked | Status |
|---|---|---|
| 1 | One source of truth; replace planning steps with the orchestrator's, marked From orchestrator; originals recoverable | Built |
| 2 | Live state in place, with a badge, 8 states | Built |
| 3 | Settings for how each state looks, theme tokens | Built |
| 4 | Orchestrator actions on the context menu, through the VPS | Built |
| 5 | Bug: stuck at `split` | Fixed in part, see below |
| 6 | Sent plans locked, lock shown | Built |
| 7 | "Plan Studio splits" | Dropped as asked, not built |

## How it works

- Nothing is copied. Every read of the tree lays the builds store over it (`web/live-core.mjs`). The build's
  `planRef` names the plan.
- When the orchestrator has filed its steps, the planning steps that were sent leave the plan and go to
  `sent-history.json` beside the tree. The orchestrator's steps are listed in their place with a From orchestrator
  badge and a tinted row.
- Steps check off when the orchestrator completes them. The page reads again every 5 seconds while a sent plan is
  moving (a setting; off is allowed).
- States: sent to orchestrator, building, merging, recompiling, running CI, waiting for merge, landed, failed.
- A sent plan refuses every edit, move, add and delete until its build lands or is cancelled. Cancel gives the
  planning steps back by itself.
- Menu: row → Orchestrator → send, queue, hold, release, retry, rebuild, run CI, land, cancel, open. The page sends
  the tap; `pipeline2.mjs actBuild` on the VPS decides and answers.

## The `split` bug: what was and was not fixed

Three causes were behind "sent plan sits at split".

1. The watchdog failed builds that were only waiting their turn. Already fixed on Nov 21 (pipeline repair part A).
2. Queue refused them: "only a Pending build can be queued". Fixed here. Queue now moves a Pipeline 2.0 build on and
   says where it stands. A test pins pending → split → active in one pass.
3. A build that gave up while it holds the active place blocks every build behind it. NOT fixed. That is the
   one-active-build rule in the status contract, and the vps-model-triage-gate hand build is working in that area.
   Live right now: `orchestrator-settings-collapsible-split` (failed, attempt 5) holds the place and 6 builds wait
   behind it. Retry or Cancel on it frees the line.

## Decisions made without asking

- History is its own file, not a field on tree items. Older checkouts and the deployed console rewrite `tree.json`
  and would have dropped the field, losing the planning steps.
- Hold is new for Pipeline 2.0 builds: only a build still waiting its turn can be held. The line and the watchdog
  skip it.
- Rebuild, run CI and land only re-enter the status contract where it allows. They never skip a stage.
- A landed plan unlocks. Its orchestrator steps stay listed, all checked.

## What to know when this lands

- `plan-studio-live-progress-one-st-6z4z` (this plan) still has its old build `plan-studio-live-progress-one-stor`
  in the flow: failed at split, gave up, 12 steps. After deploy the plan will show those 12 steps, Failed, locked.
  Tap Orchestrator → Cancel the build on it and the plan unlocks with its own steps back.
- Any other plan with a live sent build gets the same treatment on first read. That is the feature.

## Not done

- No build record exists for this hand build in the builds store, so there were no steps to tick and
  `builds-live link` had nothing to link ("no build"). The PR and this report carry the trail. The hand build is
  recorded in Plan Studio 2.0 as a note inside the plan, with a link to the PR.
- No feature in `framework/catalog/status.json` matches Plan Studio, so nothing was changed there.
- No Kotlin twin: no reference engine in `framework/core` was changed.
- Model selection was not touched.

## Tests

| Suite | Checks |
|---|---|
| `plan-studio-2/live.test.mjs` (new) | 13 |
| `plan-studio-2/server/test_orchestrate.py` (new) | 20 |
| `build-orchestrator/test/p2-actions.test.mjs` (new) | 33 |
| `plan-studio-2/test.mjs` | 19 |
| p2-flow, p2-parallel, emergency, p2-status-contract | 55, 24, 42, 53 |
| pipeline, orchestrator, watchdog, server tests | pass |

Checks run clean locally: theme, controls, toolbars, chrome assets, help coverage (100%), plugin commands, plugin
settings, console control, conform, pipeline-2, json data writes, data tables, plugin lifecycle.

One check could not run here: `framework/spec/check-build-hook.mjs` runs out of memory on this VPS. It does the same
on the untouched live checkout, so it is the machine, not this change. CI runs it.
