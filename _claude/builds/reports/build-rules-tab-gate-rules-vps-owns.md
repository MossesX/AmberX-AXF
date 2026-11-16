# Build rules tab in Gate & rules: the VPS owns and enforces the builder rules

Build `build-rules-tab-gate-rules-vps-owns`, branch `claude/build-rules-tab-gate-rules-vps-owns`.

Brett (Nov 15 2026, verbatim): "Can we put these in a build rules tab on the VPS in that rules plugin? Will it enforce it?
Will the VPS make sure it builds the home card instead of Claude? Remove it from Claude so it doesn't build it twice.
Remove everything for all the builders from Claude so it don't happen twice and put them all in that plugin."

## Answers

- **A Build rules tab in that plugin:** yes. Builds → Gate & rules → **Build rules** (the plugin folder is
  `apps/console-web/plugins/gate`; the brief said `gate-rules`, which is its contract name, not its folder).
- **Does it enforce them?** Yes, at three points: the dispatcher runs the `before` rules at launch, the build's end hook
  runs the `after` rules (fixers write what is missing and commit it on the build's branch), and the lander runs the `gate`
  rules once per green PR head; a rule that still fails blocks landing with an alert (land reason `rules`).
- **Does the VPS build the home card instead of Claude?** Yes. Rule #1 `home-card` (doer vps, phase after, fixer
  `home-card`) writes `plugins/<folder>/assets/card/home.json` (card@1) for every plugin the build touched that has none.
  Home now reads plugin cards. No session brief mentions it.
- **Removed from Claude so nothing happens twice:** the VPS rules never reach a brief (`briefBlocks` skips every `doer: vps`
  rule), and their text left CLAUDE.md, the project rules file and the hardcoded brief (table below).

## What was built (phase 2, s7–s25)

| Part | Where |
|---|---|
| Fixers (each `check` + idempotent `fix` with dry run, one result shape) | `apps/console-web/plugins/gate/fixers/`: `home-card`, `help-stub`, `shipped-features`, `api-parity`, `tracker-threads`, `run-ci-checks`, `pr-open-link` (shared `lib.mjs`) |
| Runner (before / after / gate: check → fix → re-check; every result to `runs.jsonl` and the gate History, kind `build-rule`) | `apps/console-web/plugins/gate/build-rules-runner.mjs` (`--root <worktree> --commit` commits fixes on the build's branch, never main) |
| Dispatcher | `build-orchestrator/pipeline.mjs`: `before` rules at launch, `after` rules at the session end hook (both in the background, by capability `service:axf.build-rules@1`); the brief's Look / API / Checkpoints lines and Rules block come from `briefBlocks(store)` |
| Gate | `push-banner/land/land.mjs` runs the gate rules per green head (by capability); `land-core.blockReason` → `rules`; `gate.mjs check_pr` adds `buildRules` and blocks on a failing rule |
| REST | `/api/plugins/gate/build-rules` list, `POST` add, `brief`, `history`, `runs`, `run` (dry and real), `/{id}` get / `PUT` edit, `/{id}/toggle`, `/{id}/delete` (two-step confirm) |
| Ops (one implementation for every transport) | `apps/console-web/plugins/gate/build-rules-api.mjs`, wired into `gate.mjs` |
| UI | `web/BuildRulesTab.tsx`, `BuildRulesToolbar.tsx`, `BuildRuleDialog.tsx`, `BuildRuleHistory.tsx`, `buildRulesState.ts` |
| Live store | `/projects/amberx-axf/_data/build-rules/` (`data.shared` `build-rules/`, `build-rules-migrate.mjs --live`, never overwrites); repo seed is the fallback |
| Seed | 118 rules (46 VPS, 72 session): home-card + 3 VPS-native rules (`plugin-help-stub`, `api-parity-scaffold`, `ci-checks`) + 114 inventoried; narrow rules got keyword conditions so the brief stays lean |
| Tests | `plugins/gate/test/test.build-rules.mjs` (7 checks) and `plugins/gate/test.mjs`, both now in CI |

## How each feature is reached

| Feature | Deep link / UI | REST | MCP | CLI | Voice (console action) |
|---|---|---|---|---|---|
| The tab | `console_show view:gate/tab:gate.tabs=build-rules` | `GET /api/plugins/gate/build-rules` | `gate_build_rules_list` | `axf gate build-rules list` | `gate.build-rules.open`, `gate.build-rules.list[:vps\|session]` |
| One rule | `…/setting:<rule>.enabled` | `GET …/build-rules/<id>` | `gate_build_rules_get` | `axf gate build-rules get <id>` | `gate.build-rules.who:<id>` |
| On / off | Switch per row; `console_control_set …/setting:<rule>.enabled` | `POST …/<id>/toggle` | `gate_build_rules_toggle` | `… on <id>` / `off <id>` | `gate.build-rules.toggle:<id>[:on\|off]` |
| Add / edit | Add a rule / Edit (dialog `gate.build-rule`) | `POST …/build-rules`, `PUT …/<id>` | `gate_build_rules_add`, `_edit` | `… add <id> --title … --text …`, `… edit <id> <field> <value>` | `gate.build-rules.add:<id>:<title>` |
| Delete (confirm) | Delete in the dialog | `POST …/<id>/delete` (two-step) | `gate_build_rules_delete` | `… delete <id> [--confirm t]` (exit 3 first) | not offered by voice (destructive) |
| History | `…/panel:<rule>.history` (opens it; state = the rule and last run) | `GET …/history`, `GET …/runs` | `gate_build_rules_history`, `_runs` | `… history [id]`, `… runs [id]` | `gate.build-rules.open:<id>` |
| Run a phase | Dry run / Run now in the tab toolbar | `POST …/run {build, phase, dryRun}` | `gate_build_rules_run` | `… run <build> --phase p [--dry-run]` | `gate.build-rules.run:<build>:<phase>` |
| A brief's rules | (preview) | `GET …/brief?build&title` | `gate_build_rules_brief` | `… brief <build>` | n/a |

Filters are `setting:build-rules.doer | phase | q` under the tab; rows are `grid:gate.build-rules/row:<rule>`.

## What left Claude's instructions (each against its store rule id)

| Removed | From | Store rule |
|---|---|---|
| Shipped features line ("every feature … one row in the Shipped features ledger …") | CLAUDE.md (Conventions) | `shipped-features` (fixer `shipped-features`) |
| "update + commit THREADS whenever a thread starts, changes, opens or merges a PR …" for build sessions | CLAUDE.md:14 | `threads-log` (fixer `tracker-threads`) |
| "Threads log in the repo … keeps current … update it and commit it with your work …" | `_claude/rules/RULES.md` | `threads-log`, `builds-live` |
| "Only the merge queue merges …" (landing text) | `_claude/rules/RULES.md` | `merge-queue-only` (gate) |
| "Link your branch / PR: builds-live.mjs link …" | orchestrator brief (`orchestrator-core.mjs`) and the `checkpoints` rule text | `builds-live` (fixer `pr-open-link`) |
| Hardcoded `Look:` / `API:` / `Checkpoints:` lines and the default scope line | orchestrator brief | `ui-asset-tokens`, `api-everything`, `checkpoints`, `phase-brief-scope` (session rules, now from the store) |
| "All UI code conforms to the asset system …" (full text) | CLAUDE.md | `ui-asset-tokens` (pointer line kept) |
| "Small steps for big builds …" (full text) | `_claude/rules/RULES.md` | `small-steps` (pointer line kept) |
| "Rules for this job" template guidance (rules-briefs) | `_claude/builds/BRIEF-TEMPLATE.md` | the store (`briefBlocks`) |

One pointer line replaces them in CLAUDE.md and the project rules file. Home card, help stub, API-parity scaffolding and
the CI-run were never written in CLAUDE.md or the project rules file; they were only ever in briefs, which now come from
the store. `build-rules-migrate.mjs --check` passes: every removed rule is in the seed and the live store.

**Kept on purpose:** `_claude/shared/rules/RULES.md` is shared with every project on the hub (axHub and the rest), which
this gate does not cover, so its lines stay; `claude-sync sync` was not run from this unmerged branch (it would publish the
instruction changes to every session before they reach main): it runs from the main checkout after landing.

## Notes and gaps

- The `after` and `before` runs are background, warn-only (results in History); the gate is where a rule blocks.
- Checkers that live elsewhere (`gate:ui-review`, `ci:*`, `store:steps-ticked`, `store:glossary-catalog`) show `skipped`
  in the runner; fixers named in the registry without a module yet (`scale-adopt`, `ui-review-submit`,
  `glossary-catalog`, `chrome-settings-backfill`, `shared-assets-bake`) report "no fixer module" instead of guessing.
- The brief's Rules block is 8.8k characters for a non-UI build and 16.9k for a UI build (budget 24k); trim rules in the
  tab (`when.keywords`, `applies`) to shrink it.
- The live store was edited twice during the build: the `checkpoints` text (PR link removed) and a permission test that
  switched `home-card` off and on (History shows both, by `test`).
- Kotlin twin: none needed (no Android work).

## Checks run

check-build-rules (27), check-gate-rules (35), check-landing-line (31), check-theme, check-controls, check-toolbars,
check-console-control, check-chrome-assets, plugin-lifecycle gate (clean), help-coverage (100%), glossary catalog,
gate test (21), gate build rules test (7), build-orchestrator test (35), pipeline test (52), auto-land test (110),
tsc --noEmit, vite build.

## UI Review

Waiting in UI Review: the Build rules tab, the rule dialog and a rule's History on desktop and phone, three options as
assets (the lists' grid / cards / compact view, `plugins/gate/assets/settings/`).
