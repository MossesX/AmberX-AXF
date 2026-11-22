# Orchestrator settings: collapsible Split section with parallel split

Build `orchestrator-settings-collapsible-split` (Pipeline 2.0, 10 steps) · step branches
`claude/orchestrator-settings-collapsible-split--sN` · the lander merges every step into one PR.
The earlier run of this build (PR #636) never landed; this run ports it onto the current main.

Brett said (2026-11-13 18:41): "orchestrator settings needs a collapsible section for split, with all the splitting
options, and one option splits it so it runs multiple parallel builds simultaneously to speed it up"

## What shipped

| Step | Model | What |
| --- | --- | --- |
| s1 | Fable | pipeline-settings@1: `parallelSplit` auto / ask / off (default ask), `parallelMax` (default 4, 2-12), `parallelContract` and `parallelIntegrate` (default on). `splitPrompt` / `parseSplit` carry an optional `parallel` block; `parallelSteps` builds the lead (shared contract step first, integration step last) and the parts; `parallelWait` holds parts until the contract is done and the integration step until every part has finished. build-pipeline@1 `pipeline.parallel` / `pipeline.parallelParts` (`normParallel`, `normParallelParts`). Dispatcher, CLI, REST and manifest wiring |
| s2 | Opus | `web/split-settings.tsx`: one collapsible Split block (`orch-split-settings`), its own panel of Settings → Plugins → Build orchestrator, opened expanded; split provider saved through `POST pipeline/settings`; deep link `build-orchestrator.split-settings` (or `build-orchestrator.open:split`) opens the panel and flashes the block |
| s3-s5, s7 | Opus | Every existing split option moved into the section, the parent/part family in the builds list (combined progress, lands together or in order), and the per-build "split into N parallel" override: on their own step branches, merged by the lander |
| s6 | Opus | Console action `build-orchestrator.parallel <id> <2-12\|off\|default>`; CLI usage for `parallel` and `request --parallel N\|off`; help entries for every Split field, the family card and both actions; `parallel-api.test.mjs`; feature `cx.buildengine.parallelsplit` (built) in catalog.json / status.json, tracker regenerated |
| s8 | Opus | Tests run on the merged s1 + s2 + s6 code, this report, THREADS row |

## How each part is reached (API rule)

| Thing | UI | REST | MCP | CLI | Voice |
| --- | --- | --- | --- | --- | --- |
| Split settings | Settings → Plugins → Build orchestrator → Split; deep link `build-orchestrator.split-settings` | GET / POST `pipeline/settings` | `pipeline-settings`, `pipeline-settings-set` | `pipeline.mjs settings`, `set k=v` | "set parallel split to auto" |
| Per-build parallel | action `build-orchestrator.parallel <id> <N>`; "split into 3 parallel" in the request words | POST `pipeline/parallel`, `pipeline/request {parallel}` | `pipeline-parallel`, `pipeline-request` | `pipeline.mjs parallel`, `request --parallel` | "split skins into 3 parallel builds" |
| Family (lead + parts) | grouped rows with combined progress | GET `pipeline` rows | `pipeline-status` | `pipeline.mjs show <id>` | "status of skins" |

control@1: nothing to add. It covers tokens and planner items only; the Split fields and the parallel action are
console-control addresses through the action registry.

## Tests (s8, Nov 22 2026, on `--s6`, which merges s1 and s2)

| Test | Result |
| --- | --- |
| `pipeline.test.mjs` | 72 checks pass (main: 66) |
| `parallel-api.test.mjs` | 44 checks pass (REST, MCP, voice, CLI, console actions, help) |
| `split-settings.test.mjs` | pass (section, panel, deep link, saved keys accepted by REST, help) |
| `test.mjs` | 35 checks pass |
| `test.py` | 73 checks pass |
| `build-id`, `groups`, `status-table`, `toolbar` tests | pass |

- `pipeline.test.mjs` fails at "e2e one way to start builds" when it runs inside a dispatched build session. That
  happens on main too: the session's own `AXF_DISPATCH_TOKEN` / `AXF_*` variables leak into the dispatch-gate e2e.
  With those variables unset, every check passes. This is a test-isolation bug in the e2e, not part of this build.
  The fix is to strip `AXF_*` from the env the test hands its child processes.
- `tsc --noEmit` did not run in s8: there are no installed node_modules on this box. s2 ran tsc, check-theme,
  check-controls, check-toolbars and help-coverage, and all passed. The PR's light check runs tsc again.
- The s3, s4, s5 and s7 branches were not pushed when s8 ran, so their tests run with the lander's merge.

## Open

- UI Review: the Split section needs desktop and phone shots from a console that reaches axHub, then `review.mjs submit`.
  The earlier run could not render the console headless.
- Kotlin twin of `pipeline.parallel` / `parallelParts`: deferred (framework/spec/PORTING.md).
- pipeline.test.mjs env isolation (above): small follow-up.
