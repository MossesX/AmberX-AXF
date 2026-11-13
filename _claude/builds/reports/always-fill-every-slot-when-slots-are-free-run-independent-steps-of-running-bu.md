# Fill every slot (`always-fill-every-slot-when-slots-are-free-run-independent-steps-of-running-bu`)

Brett: "Always fill every slot: when slots are free, run independent steps of running builds in parallel across them,
and auto-queue pending builds." Branch `claude/always-fill-every-slot-when-slots-are-free-run-independent-steps-of-running-bu`, PR #554.
Phase 1 (Fable, s1-s8): the contract (`framework/spec/BUILD-PARALLEL.md`, `planFill`, claims, fixtures). Phase 2 (Opus,
s9-s26): this report.

## What phase 2 adds

| Step | What |
|---|---|
| s9 | `builds-store.mjs migrate-deps [--dry]`: older builds keep no `dependsOn`; `meta.versions.stepDeps` stamped in one journal line (`migrate-step-deps`); the dispatcher runs it on its first tick. `verify` names a dependency on a missing step and every cycle (exit 1). |
| s10 | The Opus split prompt asks for `dependsOn` (default: the previous step) and `files`; `parseSplit` validates ids, refuses later steps and cycles; ids are renumbered with the steps when done steps are kept. Rules splits and hand-written steps are untouched. |
| s11 | Claude settings `builds.fillSlots` (on; anyone switches it off, only Brett on), `builds.maxParallelPerBuild` (3; only Brett raises it), `builds.autoQueuePending` (off; owner-only). A raise-only toggle is new in claude-settings core. |
| s12 | `ensureStepWorktree` (`<root>/<build>--<step>`, branch `<build-branch>--<step>` off the build branch), `mergeStepBack` (under the store lock, `--no-ff` in the build worktree, push, delete the step branch; deferred while the build worktree is dirty), `conflictBack` (abort, step back open with a `blocked:` note, re-runs after the steps it clashed with in the build's own session, branch kept). |
| s13 | `claude-headless.sh --step <id>`: the brief is rewritten to the step only (`pipeline.mjs step-brief`), session `axf-<build>--<step>`, its own agent slot (`agent-slots enqueue --step`), per-step model gate (`model-gate launch --step`, `stepLaunchCheck`). |
| s14 | The tick's fill round: `planFill` over running builds (the build's own session holds an in-memory claim on its first ready step), each `step` launch claimed on the build (builds-live), started in its worktree, recorded in the build notes; step ends merge back; a step that ends unticked is ready again, at most 3 runs, then left to the build's own session. A build whose own session ends while steps run stays in Building and is re-queued if steps are left. |
| s15 | Auto-queue: with the setting on and no Queue build waiting, split Pending builds with no file clash move to the Queue (note `auto-queued: slots free`), one alert (`pipeline.autoqueue` in notify.json; also `pipeline.step-conflict`). |
| s16 | Reconciler: a dead step session's claim is released (worktree kept); step branches are kept out of build / orphan matching; a build is built only when every done parallel step's branch has merged back. |
| s17 | `agent-slots.mjs fill` (planFill dry run via the pipeline when installed); the idle alert also fires when slots are free and ready steps wait (`kind: slots`). |
| s18 | REST: `GET /pipeline/fill[?build=]`, `POST /pipeline/fill/run`, `POST /builds/:id/steps/:step/deps`, fill keys on `POST /pipeline/settings` (autoQueuePending refused unless Brett's own session). Owner approval comes from `axf.claude-settings@1`'s new `set_for(request, values)`. |
| s19 | MCP plugin commands `pipeline-fill-status`, `pipeline-fill-run`, `pipeline-step-deps`, `pipeline-fill-settings` (+ route `POST /pipeline/fill/settings`); CLI `pipeline.mjs fill status|run|deps|set`; voice / console actions of the same names. |
| s20-s22 | Pipeline tab Slots strip (role=toolbar, `data-axf-toolbar="build-orchestrator.slots"`), "N steps running in parallel" badge, Step dependencies view with a ChoiceGrid editor, Settings → Plugins → Build orchestrator → Fill every slot (owner rules, greyed out for sessions, strip layout). |
| s23 | help.json entries; `_claude/builds/README.md` section "Pipeline: fill every slot"; glossary check passes. |
| s24 | `test/fill-slots.test.mjs` (11 checks): real git step worktrees, merge, conflict, dirty-tree deferral, reconciler rules, and the dispatcher end to end with a fake `claude` in `HOME/.local/bin` (4 slots, a DAG build and a linear one: s3 and s5 fill slots, s4 held by its clash with s2, branches merge back and are deleted, auto-queue only with the setting on, nothing with fill off). `test.py`: 24 new route checks incl. the owner-only refusals. |

## How each feature is reached

| Feature | Deep link (`console_show`) | REST (`/api/plugins/build-orchestrator`) | MCP | CLI | Voice / console action |
|---|---|---|---|---|---|
| Slots and the next round | `build-orchestrator/pipeline/slots` | `GET /pipeline/fill` | `pipeline-fill-status` | `pipeline.mjs fill status`, `agent-slots.mjs fill` | `build-orchestrator.pipeline-fill-status` |
| One round now | (Fill now on the strip) | `POST /pipeline/fill/run` | `pipeline-fill-run` | `pipeline.mjs fill run` | `build-orchestrator.pipeline-fill-run` |
| A step's dependencies | `build-orchestrator/<id>/steps` | `GET /pipeline/fill?build=<id>`, `POST /builds/:id/steps/:step/deps` | `pipeline-step-deps` | `pipeline.mjs fill deps <b> <s> <ids\|none\|sequential>` | `build-orchestrator.pipeline-step-deps:<b>/<s>/<deps>` |
| Fill settings | `settings/plugins/build-orchestrator#fill` (action `build-orchestrator.settings:fill`) | `POST /pipeline/fill/settings`, `POST /pipeline/settings` | `pipeline-fill-settings` | `pipeline.mjs fill set k=v` (through the console route) | `build-orchestrator.pipeline-fill-settings:<k=v,…>` |

Deep links use the `build-orchestrator` screen: `builds/…` (as the step text said) belongs to the separate Builds page
plugin, so a `builds/pipeline/slots` target would open that screen instead.

## Checks

check-build-pipeline-fill 38 · check-builds-store 48 · pipeline.test 49 · test/fill-slots 11 · test.py 62 · test.mjs 35 ·
claude-settings 56 · check-model-policy 19 · check-builds-live 62 · check-theme, check-controls, check-toolbars,
check-chrome-assets green · glossary catalog --check complete · console-web `tsc --noEmit` clean for the plugin.

Not green / not done:
- `test/fill-slots.test.mjs` failed once in a batch run and passed the 3 runs after it; the failing output was lost
  (only the last line was kept). Possible flake in the end-to-end part; worth watching in CI.
- `plugin-lifecycle check build-orchestrator` still lists 3 stale references in `framework/spec/check-build-limit.mjs`
  and `framework/spec/check-projects.mjs`; they are on main already, not from this build.
- `check-agent-slots` shows 2 failures from this VPS's real agent booking (`booked on …`); same on the base commit.
- **s25 (UI Review) is open.** The scratch console that `rebuild-shots.mjs` starts here (`AXF_APPEARANCE_HUB=off`) never
  loads the orchestrator's web screens, with this branch's code and with main's, so the Slots strip, Step dependencies
  and the settings panel could not be shot. The three strip layouts ship as toolbar assets
  (`plugins/build-orchestrator/assets/toolbar/build-orchestrator-slots-{chips,grid,list}.json`); the next session on a
  console that shows the orchestrator shoots them (desktop + phone) and submits with `review.mjs submit --choices`.
- Found while probing shots: importing `@console/account` from a plugin creates a load cycle (it imports the plugin
  registry); the settings panel reads `/api/me` itself instead.

## Deferred

No Kotlin / Python twin of the planner (VPS-only dispatcher), as recorded in `framework/spec/PORTING.md` in phase 1.
