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
