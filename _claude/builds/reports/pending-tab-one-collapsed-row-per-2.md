# Pending tab: one collapsed row per build (rebuild)

Build `pending-tab-one-collapsed-row-per-2` · Brett said (2026-11-15 11:52): "Why are pending builds not 1 expandable row. Wanna just rebuild it"

## Design note (s1): the Pending tab on main

**Where it is drawn.** `web/ui.tsx` `OrchestratorPage` renders the tab row (framework `TabGroup`) and, for the stage tabs
(pending, queue, active, incomplete, complete, errors, archive, deleted, accounts), `PipelineTab` from `web/pipeline.tsx`.
`PipelineTab` loads `GET /pipeline` every 10 s and, for the chosen view, draws:

- a header with the count and a one-line hint,
- a bulk toolbar (`.pl-bulk`, Select all + one button per build action),
- `PipelineTable`: the shared `DataGrid` (one grid row per build: select, title + id, priority, status, steps, account,
  model, when). A tap expands the grid row into `PipelineCard embedded`, which repeats the said line, a `pd-meta` strip,
  the planned account, a nested `StepsGrid` (a second DataGrid), notes from the pipeline and an action row.

On a phone the DataGrid falls back to stacked cells, so one pending build draws as many lines (title, id, priority,
status, steps, account, model, when, each its own line) and the expanded view nests a second grid: that is what Brett
saw as "not 1 expandable row". Expanded state lives in a module variable (`OPEN[view]`), lost on reload and not shared
with any API.

**Data a pending row reads** (`pipeline.mjs` `row(b)`, served by `GET /pipeline` → `tabs.pending`, and
`GET /pipeline/tab/pending`): `id`, `title`, `status`, `priority` (P0-P3 label), `steps {done,total,left}`,
`stepList [{id,text,model,estimate,done,skip}]`, `nextModel`, `nextStep`, `needsApproval`, `needsSplit`,
`pipeline {planned, splitRequested, route, lastRun, note…}`, `said` (build-origin@1 subtitle), `createdAt`,
`updatedAt`, `actions` (from `actionsFor()`). There is no explicit "why pending": it has to be derived (needs your
upgrade approval, needs a split / splitting, back from a run, or simply waiting for Queue). Build notes are not in the
row; they live on the build record.

**Actions on a pending build today.**

- Queue: `POST pipeline/queue {id}` (CLI `pipeline.mjs queue`, MCP `pipeline-queue`, console action `build-orchestrator.start:<id>`).
- Runs on (route): `POST pipeline/route`; Split now: `POST pipeline/split`.
- Archive / Delete: `POST pipeline/action {action, ids}` (MCP `pipeline-build-action`, console action
  `build-orchestrator.archive:<id>`). There is no confirm on the pending card today.
- Edit: only on the All builds tab (`BuildCard` → `POST act {action:'update', id, title, detail, branch, category}`,
  CLI `orchestrator.mjs act`).

**Plan.** A pure helper (`pending-rows.mjs`) turns each pending build into one collapsed-row summary and owns the
per-viewer expanded set; the server stores that set in the plugin data dir and serves it (`GET pending/rows`,
`POST pending/rows/<id>/expand|collapse|toggle`, `POST pending/rows/collapse-all`); a `PendingRow` component draws one
line per build (title, status chip with why, PriorityTag, steps, age) and an expanded body with steps, notes, what
Brett said and a Queue / Edit / Archive toolbar. The same state is reachable from REST, MCP, the CLI and voice.

## Before / after

| | Before (main) | After |
|---|---|---|
| A pending build | One DataGrid row with eight cells; on a phone the cells stack into eight lines | One row: title, then a status chip with **why** it is pending, priority, steps done/total, age. Phone: two lines (title, chips) |
| Expanded | A nested card repeating the meta strip, plus a second DataGrid of steps | Steps with done ticks and Fable / Opus badges, notes, What Brett said, and one toolbar: Queue, Edit, Runs on, Split now, Archive (asks first) |
| Which rows are open | A module variable, lost on reload, invisible to any API | Saved per viewer in the plugin data dir (`.axf-console/plugins/build-orchestrator/pending-rows.json`), readable and settable from REST, MCP, CLI and voice |
| Collapse all | none | **Collapse all** button (and API) |

Shots (desktop + phone, collapsed and one expanded, each of the three layout options):
`_claude/builds/reports/pending-tab-one-collapsed-row-per-2/shots/`, made by `shoot.mjs` next to them (vite preview of
the worktree, mocked `/api/me`, pipeline and pending routes backed by the real `pending-rows.mjs`).

## How each part is reached

| What | Deep link / console | REST | MCP | CLI | Voice (console action) |
|---|---|---|---|---|---|
| The Pending tab | `build-orchestrator.tab:pending`; control `view:build-orchestrator/tab:build-orchestrator.tabs=pending` (TabGroup) | `GET /api/plugins/build-orchestrator/pending/rows` | `pending-rows` | `orchestrator.mjs pending rows` | `build-orchestrator.pending-rows` |
| One row | `?axf-target=row:<build>`; `console_show` / `console_open` `row:<build>` (console-focus@1 resolves it; the row opens, scrolls into view, is highlighted); control `…/grid:pending/row:<build>` (open, state, focus, set `expanded`/`collapsed`/`toggle`), header `…/row:<build>/button:toggle` | `POST …/pending/rows/<build>/expand\|collapse\|toggle` | `pending-expand`, `pending-collapse`, `pending-toggle` | `orchestrator.mjs pending expand\|collapse\|toggle <build>` | `build-orchestrator.pending-expand\|collapse\|toggle:<build>` |
| Collapse all | button `pending-collapse-all` | `POST …/pending/rows/collapse-all` | `pending-collapse-all` | `orchestrator.mjs pending collapse-all` | `build-orchestrator.pending-collapse-all` |
| Queue | button in the row toolbar | `POST …/pipeline/queue` | `pipeline-queue` | `pipeline.mjs queue <build>` | `build-orchestrator.start:<build>` |
| Edit (title) | button in the row toolbar | `POST …/act {action:"update"}` | `act` | `orchestrator.mjs act rename <build> <title>` | — (MCP / CLI) |
| Archive | button, asks first | `POST …/pipeline/action {action:"archive"}` | `pipeline-build-action` | `pipeline.mjs archive <build>` | `build-orchestrator.archive:<build>` |
| Runs on / Split now | buttons in the row toolbar | `POST …/pipeline/route`, `POST …/pipeline/split` | `pipeline-route`, `pipeline-split` | `pipeline.mjs route\|split` | — (MCP / CLI) |

The viewer is the `viewer` field / `?viewer=` / `X-Axf-Viewer` header, else the signed-in hub user, else `console`
(CLI: `--viewer`, else `AXF_VIEWER`, else `console`). Every interface answers with the same
`{ viewer, expanded, count, rows }` because the REST routes, the MCP commands (read statically from the routes) and the
voice actions (`pending-rows.mjs actionRoute()`) all end in `orchestrator.mjs pending`.

## Tests

- `test/pending-rows.test.mjs` (13): summary, why pending, age, notes, viewer keys, expand / collapse / toggle /
  collapse all without mutation, per-viewer separation, junk dropped, voice action → route mapping.
- `test/test_pending_rows.py` (18): the same sequence through REST, MCP (plugin-commands plan → dispatched route), CLI
  and voice (actionRoute → route) gives identical state at every step; viewer A's expanded rows never open for viewer B
  (body, query and header); 404 / 400 guards; console-focus resolves `row:<build>`.
- Existing plugin tests still green: `test.mjs` 35, `pipeline.test.mjs` 52, `build-id.test.mjs` 7, `groups.test.mjs` 8, `test.py` 47.
- Checks: check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, control-inventory
  --check, plugin-commands check, help-coverage --check, glossary catalog --check, tracker --check, builds-store verify,
  `tsc --noEmit` all pass. plugin-lifecycle check passes on a clean checkout (in the build worktree it flags the
  untracked session files `.axf-brief.md` / `.axf-focus.json`, which are not in the repo).

## UI Review

Item `r-20261115-2464b94c`, group "pending-tab-one-collapsed-row-per-2 - Nov 15 12:18 PM", with three layout options as
container assets (`apps/console-web/plugins/build-orchestrator/assets/container/pending-row-layout-*.json`): **one line**
(default), **compact**, **title then chips**. The CSS for all three ships (`.oc-prows[data-layout]`); one line stays the
default until a pick.

## Notes and open items

- Removed from Pending with the old grid: the bulk select toolbar and the per-row Delete button. Delete stays reachable
  from the row's context menu, MCP `pipeline-build-action` and `pipeline.mjs delete`; the other tabs keep bulk select.
- The step brief named `view:builds/tab:orchestrator=pending`; the real address of that tab is
  `view:build-orchestrator/tab:build-orchestrator.tabs=pending`, registered by the framework TabGroup, so no alias was added.
- Shipped features ledger: `shipped.mjs gather` builds this build's manifest (commits, steps, the UI Review item); the
  ledger row is written by the build hook when the merge queue lands it.
- Kotlin twin: not applicable (console-only plugin UI).
