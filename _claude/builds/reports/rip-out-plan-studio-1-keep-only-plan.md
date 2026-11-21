# Build report — `rip-out-plan-studio-1-keep-only-plan` (Fable, Nov 21 2026)

Branch `claude/rip-out-plan-studio-1-keep-only-plan`. Source: Plan Studio 2.0 plan **Removals** (Brett, Nov 20 2026), step
"Remove Plan Studio 1 (old Plan Studio) and everything tied to it: migrate any plans or data still only there into Plan
Studio 2.0 with count checks, repoint voice/API/MCP commands to 2.0, then delete the plugin, routes, menu entries,
settings, tests and docs". Rule of that plan: move what is in use to its replacement, verify nothing is lost, remove,
then a reference scan shows zero hits and CI is green.

## Result

Plan Studio 2.0 (`plan-studio-2`) is the console's one Plan Studio. The original plugin is gone from the code, the
menus, Settings, the help pack, the MCP tool list and CI. Its plans are in the 2.0 tree. Everything that used to talk
to it now talks to 2.0.

## Archived, then removed

- **Code:** git tag `archive/plan-studio-1` (pushed) is the last commit with `apps/console-web/plugins/plan-studio/`
  (36 files: `plans.mjs`, `catalog.mjs`, server, web, schema, fixtures, seed plans, help pack, tests).
  `git checkout archive/plan-studio-1 -- apps/console-web/plugins/plan-studio` brings it back.
- **Data:** the hub folder `/projects/amberx-axf/_data/plan-studio/` (8 plans, 275 history files, categories,
  blueprints, catalog-seen, deleted list, shipped log) is left exactly as it was: a read-only archive. Nothing reads
  or writes it any more. Nothing was deleted on the hub. The data-store path map still maps it (`planner/…`), so its
  rows in axf-data stay valid.
- **Removal:** `node framework/cli/plugin-lifecycle.mjs uninstall plan-studio --all` (folder, marked doc lines), then
  `check plan-studio --after-uninstall`: clean.

## Moved into 2.0 (count checks)

One-off script `_claude/builds/reports/rip-out-plan-studio-1-keep-only-plan/migrate-plans.mjs` (reads the old plan
files, never writes them; refuses to save when a count differs; a second run adds nothing). Run on the hub store:

| | Old store | 2.0 tree |
|---|---|---|
| Plans | 8 | 8 (inside the new top-level section **From Plan Studio 1**) |
| Steps | 210 (14 + 31 + 68 + 97) | 210, done flags, model and minutes kept; a section per phase where the plan had phases |
| Requirements, acceptance, decisions, questions, risks, out of scope | 41 entries (32 + 9) | 41 list items in a list per kind |
| Comments | 1 | 1 note |
| Tree items | 454 before | 732 after (278 added) |

Each plan keeps its title, status (`building` → `active`), priority and tags (+ `plan-studio-1`); summary, goal, why,
body, links, category, owner and the old id are in the body. A copy of the tree from before the move is at
`/root/plan-studio-2-tree.before-migrate-2026-11-21.json` on the VPS.

Not moved, on purpose: the 275 history files (old versions of plans cleared out on Nov 16), categories, blueprints,
catalog-seen and the shipped log (1.0-only bookkeeping, nothing in 2.0 uses it), and the two Test Sandbox seed plans
(test data; `project-seed.mjs seed` writes them into the sandbox's 2.0 tree now).

## Repointed

| What | Before | Now |
|---|---|---|
| plans@1 capability | `plan-studio/plans.mjs`, server `PlansService` | `plan-studio-2/plans.mjs` (plans@1 over the tree: a plan = a tree item of kind `plan`) and the 2.0 server's `PlansService` (`list` / `get` / `park`) |
| control@1 `planner.plans` (REST `/api/control`, MCP `control_*`, CLI `axf control`, voice) | plan@1 files | the tree. Same fields and verbs. `ready` → draft, `building` ↔ active, `dropped` → parked; `summary` / `goal` / `why` go into the body; `category` on add = the item to put it inside; `comment` adds a note; `remove` = the tree's trash; `restore` = undo of the newest delete (the tree keeps no versions) |
| "Put it in a plan for later" (rule, MCP `plan_park`, voice "plan …", "park the idea …") | parked plan@1 plan | parked plan in the 2.0 tree |
| Orchestrator priority rows ("Plan linked to it") | plans@1 of 1.0, route `plan-studio` | plans@1 of 2.0 (the build link Send to build writes), route `plan-studio-2` |
| `project-seed.mjs` plans | 1.0 store | the sandbox project's 2.0 tree |
| "plan studio" in `console_open` / `console_show` / `axf console open` / voice | view `plan-studio` | view `plan-studio-2` (see the fix below) |
| Console help pack | screen `plan-studio`, its intro and Reader entry | screen `plan-studio-2`, new intro |
| Docs | README, CONTROL.md, CONSOLE-CONTROL.md, RULES, DATA-STORE, DATA-INVENTORY, MCP docstrings | point at 2.0; the 1.0 memory doc carries a "removed" note |

## Fixes found on the way

- **"plan studio" opened the wrong screen.** With 1.0 gone, `consoleResolve` read "plan studio" as the old **Plan**
  screen plus the focus "studio". Engine fix (`framework/core/engines/console-commands.mjs`): a screen's keywords of two
  or more words are exact names of it (also in front of a focus: "plan studio / Removals"), and leading words followed
  by a whole screen name ("go to plan studio") name that screen. One-word keywords only score, as before. 9 new cases
  in `check-console-commands.mts`. Kotlin twin recorded as deferred in `PORTING.md`.
- **Root CLI writes locked the console out of the tree file.** `tree.mjs` saved `tree.json` as `root:deploy 644` when a
  VPS session ran it. It now hands the file back to the folder's owner, group-writable.
- **Help coverage.** Five controls on other screens (Plan view "Remove link", MD Studio "Write", the Plan Studio 2.0
  toolbar button, "Project…", systems check "Save anyway") only had help because the removed pack happened to define
  the same ids. Each now has its own entry; coverage is back at 100%.
- The uninstall also stripped the Plan Studio 2.0 README line and one unrelated THREADS row; both are restored.

## One mistake, cleaned up

The first run of `token-control/test.mjs` after the repoint still set the old `AXF_PLANS_DIR`, so it wrote one test
plan ("Control test plan", with a note) into the live tree and left "Pass plan" in its trash (19:37 UTC). Seven minutes
later both were removed (exactly those two items and that one trash entry, checked by id), the file's owner was set
back, and the tree was at its 454 items again before the migration ran. The test now sets `AXF_PLAN_TREE_DIR`.

## How it is reached (everything comes with an API)

Nothing new has a UI. What changed hands:

| Feature | UI | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| Open Plan Studio | Plan → Plan Studio 2.0, Builds toolbar | `POST /api/console/open {"screen":"plan studio"}` | `console_open` / `console_show` "plan studio" | `axf console open plan studio` | "open plan studio" |
| Plans as planner items | the page | `POST /api/control` `planner.plans` list / get / add / set / remove / act | `control_*`, `plan_park` | `axf control … planner.plans` | "plan <title>", "park the idea <title>" |
| The tree itself | the page | `/api/plugins/plan-studio-2/*` | `plan-studio-2_*` | `tree.mjs`, `axf plan-studio-2 …` | "plan studio …" (`say`) |

## Left as they are (say so, not hidden)

- Test files that build their own made-up catalog with a screen called `plan-studio` / "Plan Studio"
  (console-commands, follow-amber, ref-links, wake-listener tests, `check-console-commands.mts`, `check-help.mts`,
  `gen-fixtures.mts` and their fixtures). They test name resolution with a sample name, not the removed plugin.
- Data-store maps, table definitions and their checks for `_data/plan-studio/**`: the archive is still there.
- History: `changes/`, `sessions/`, shipped build records, older reports.
- Baked `src/axf` copies of `control-rules.mjs` and `schemas/control.json` were already behind the framework before
  this build (CI re-bakes them); the ones that were in step (`build-priority.mjs`, `console-commands.mjs`) are synced.
- `framework/catalog/status.json`: no catalog feature covers this cleanup, so nothing to set.
- AmberX app: the removed plugin also listed `amberx-droid` as a target. That repo was not touched here.

## Clash check (pending list)

`postgres-part-b-plan-plan-studio-catalog` (Opus, 4/4 steps, landed) moved the planner data to tables; this build keeps
its path map and tables as they are. No other pending item touches Plan Studio.

## Checks

`plan-studio-2/test.mjs` (19, with plans@1), `token-control/test.mjs` (22), `test_emergency.py` (25, with the plans@1
service), console-commands (Node 11, server 149), follow-amber, ref-links, MCP tools (229), data store,
`check-control`, `check-console-commands` (123), `check-help`, help coverage, `check-page-toolbar-voice` (inventory
regenerated: 168 phrases), `check-token-registry`, `check-data-tables`, `check-data-migrate`, `check-theme`,
`check-controls`, `check-chrome-assets`, `plugin-lifecycle check` for both folders, console `tsc --noEmit`.
