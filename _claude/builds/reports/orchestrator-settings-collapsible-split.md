# Orchestrator settings: collapsible Split section with parallel split

Build `orchestrator-settings-collapsible-split` · branch `claude/orchestrator-settings-collapsible-split` · PR #636

Brett said (2026-11-13 18:41): "orchestrator settings needs a collapsible section for split, with all the splitting
options, and one option splits it so it runs multiple parallel builds simultaneously to speed it up"

## What shipped

| Step | Model | What |
| --- | --- | --- |
| s1 | Fable | Split section (collapsible, Settings → Plugins → Build orchestrator → Split); parallel split auto / ask / off, max slots 2-12, contract first, integration last; parseSplit reads Claude's `parallel` block; splitBuild files the parts; dispatcher barriers (parallelWait); build-pipeline@1 `pipeline.parallel` |
| s2 | Opus | Covered by s1 (section in place, deep link `build-orchestrator.split-settings`) |
| s3 | Opus | Every split option in the one section: split provider, largest step (moved from Token rules), model per step, how phases form, the step format for steps written by hand |
| s4 | Opus | Parts linked to the lead: `parallelFamily` (lead, parts, combined progress, landing); both build lists group a family as one sub-group with combined progress; cards show the family; parts keep the lead's category; `pipeline.parallel.landing` together / own; the part briefs say how they land |
| s5 | Opus | Per-build override: `pipeline.parallelParts` (0 settings, 1 one build, 2-12 parts) from Add a build → Parallel builds, `act add {parallel}`, `pipeline request --parallel`, `pipeline parallel <id> <N|off|default>`, or "split into 3 parallel" in the words; an ask for N parts gives exactly N even when the setting is off (the parts then wait in Pending) |
| s6 | Opus | REST `POST pipeline/parallel`, `POST pipeline/request {parallel}`; MCP `pipeline-parallel` (+ request field); voice phrases; console action `build-orchestrator.parallel`; Parallel builds picker on Pending / Queue cards; help entries; feature `cx.buildengine.parallelsplit` |

## How each part is reached (API rule)

| Thing | UI | REST | MCP | CLI | Voice |
| --- | --- | --- | --- | --- | --- |
| Split settings | Settings → Plugins → Build orchestrator → Split; deep link `build-orchestrator.split-settings` | GET / POST `pipeline/settings` | `pipeline-settings`, `pipeline-settings-set` | `pipeline.mjs settings`, `set k=v` | "set parallel split to auto" |
| Largest step | Split section | POST `act {action: rules}` | orchestrator act | `orchestrator.mjs act rules` | through the act tool |
| Per-build parallel | Add a build → Parallel builds; Pending / Queue card picker; action `build-orchestrator.parallel <id> <N>` | POST `pipeline/parallel`, `pipeline/request {parallel}` | `pipeline-parallel`, `pipeline-request` | `pipeline.mjs parallel`, `request --parallel` | "split skins into 3 parallel builds" |
| Family (lead + parts) | grouped rows, family note on cards | GET `pipeline` rows `family` | `pipeline-status` | `pipeline.mjs show <id>` | "status of skins" |

control@1: nothing to add (no tokens or planner items here); the settings fields and the action are console-control
addresses through the action registry.

## Tests

- `pipeline.test.mjs`: 52 checks (normParallel landing, normParallelParts, parallelAsk, splitSettingsFor, exact prompt,
  parallelFamily on store builds and rows, CLI end-to-end: family on status rows and `show`, `request --parallel`,
  `parallel off|default`, refused on a lead and out of range)
- `test.mjs` 35 checks, `test.py` 46 checks (`_parallel_arg`)
- `tsc --noEmit`, check-theme, check-controls, check-toolbars, check-chrome-assets: pass
- help-coverage console-web: the one gap left is `gizmo-guide` (molly-guide plugin, not this build)

## Open

- UI Review: not submitted. `rebuild-shots.mjs` could not render the console from this box (the scratch console waits on
  axHub: fetch failed; with `--web-port 5173`, a blank page). The section needs desktop and phone shots taken from a
  console that reaches axHub, then `review.mjs submit`.
- Kotlin twin of `pipeline.parallel` / `parallelParts` deferred (framework/spec/PORTING.md).

## Landing (s10, Nov 21 2026)
Merged origin/main (Pipeline 2.0 status table, watchdogs rewrite) into the branch.
- Main replaced the orchestrator's tabs with one status table and moved Rules into Settings panels. The Split section is now the first Build orchestrator settings panel (order 5); `build-orchestrator.split-settings` opens Settings and flashes it. Step size and the model guide stay inside Split; the Rules panel keeps the token rules only.
- Parallel families (lead + parts) are now grouped in the status table with their combined progress (`status-table-core` rows carry `parallel`; `family.ts` `splitFamilies`).
- Main dropped the orchestrator's own filing form, so the per-build override when filing is reached through `act add {parallel}`, the details text ("split into 3 parallel"), `build-orchestrator.parallel <id> <N>`, REST `POST pipeline/parallel`, MCP and the CLI.
- Watchdog files and plan-studio-2's manifest: main's versions (main carried the same done-means-merged fix).
