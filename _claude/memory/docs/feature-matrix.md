# Feature matrix (feature-matrix@1)

Brett, Oct 28 2026: every build gets a keep/skip **feature matrix** like the windows-terminal scope list. Items are
grouped, each with its time cost, its model and why it is there; tick = keep, untick = skip; items can be added at any
time and are **never deleted** ("remove" = skip; a skipped item stays in the matrix and is skipped when the build runs).
All matrices are **one dataset**, shown as a grid of expandable rows (row = build; columns include date added and the
time cost of the kept items). Editing a matrix lights an **Apply** button; Apply pushes the result to every table the
build lives in. Every builds grid gets a hook to its entry's matrix. Orchestrator build `feature-matrix` (Refactor profile).
<!-- axf-plugin:feature-matrix -->

Fable phase (s1–s2, branch `fable/feature-matrix`) built the contract and the Apply engine. Opus phase (s3–s8) builds
the console plugin on top of them.

## Files

| File | What |
| --- | --- |
| `framework/plan/feature-matrix-core.mjs` (+ `.d.mts`) | the contract: dataset shape, normalisation, `apply()` actions, `totals()`, `grid()`, seed helpers, `validate()` |
| `framework/plan/feature-matrix-apply.mjs` (+ `.d.mts`) | the Apply engine: `projectBuild / projectPending / projectQueueRecord / projectChange / projectFeature`, `applyAll()` |
| `framework/spec/fixtures/feature-matrix.json` | replay fixture: scenario → expected dataset, totals, grid; targets before/after Apply, report, second pass |
| `framework/spec/check-feature-matrix.mjs` | the check (CI, `android.yml`); `--write` regenerates the fixture from the reference cores |

## Dataset

```
{ $axf: 'feature-matrix@1', updatedAt, matrices: [Matrix] }
Matrix { id, ref: { kind, id }, profile, title, createdAt, updatedAt, version, appliedVersion, appliedAt, items: [Item], history: [...] }
Item   { id, name, why, group, minutes, model: 'Fable'|'Opus', state: 'keep'|'skip', addedAt, updatedAt,
         source: { kind: 'step'|'sub'|'acceptance'|'manual', id }, history: [{ at, action, from?, to? }] }
```

- `ref.kind` = the table the build lives in: `orchestrator` (build id), `pending` (item id), `queue` (build-queue step
  id), `plan` (feature id), `change` (change-log entry id). **Matrix id = `<profile>:<kind>:<id>`**, so any grid row
  finds its matrix without a lookup (`fm.matrixId(ref, profile)`); the same build in two profiles has two matrices.
- `version` bumps on every content change (created, seeded, add/restore item, state, edit, rename); `appliedVersion`
  is the last version Apply pushed out; **dirty = version > appliedVersion** lights the Apply button. `applied` does
  not bump the version.
- Item ids are slugs of the name (or the step id when seeded from steps); unique within the matrix.
- History is kept on the matrix (capped 300) and on each item (capped 60).

## Actions (`fm.apply(state, change, now?)`)

`add` (refuses a duplicate) · `seed` (adds the matrix when missing, then only the items it lacks: idempotent; existing
items are never touched by a reseed) · `add-item` (an existing id = **restore**: back to keep + merge the fields given)
· `keep` / `skip` / `set-state` · `edit-item` (name, why, group, minutes, model) · `rename` · `applied` (version ≤
current; records appliedAt) · `remove-item` and `remove` **always throw**. Every change returns `{ state, matrix, item,
log }`; pass `now` for reproducible output.

Seed helpers turn what a build already has into items (nothing invented): `itemsFromSteps` (orchestrator steps, source
`step`), `itemsFromSubPrompts` (pending sub prompts / queue small steps, source `sub`), `itemsFromAcceptance` (plan
acceptance lines). They read the `skip` and `fm` tags Apply writes, so seeding after an Apply round-trips.

## Apply engine (`ap.applyAll(matrix, { build?, pending?, queue?, change?, feature? }, now?)`)

Pure, idempotent, never deletes, never undoes `done`:

| Target | Rows | What Apply sets |
| --- | --- | --- |
| orchestrator build | steps | `skip` (new step field), `estimate` (`<minutes> min`), `model`; `why`/`group` when empty; a kept item with no step → new step `fm-<item id>` |
| pending item | subPrompts | `skip`, `fm`, `estimate`; item `estimate` = kept minutes |
| build-queue record | steps | same as pending; record `estimate` = kept minutes |
| change-log entry | steps | queued ↔ skipped (done/failed/running untouched), `fm`; `estimate = { minutes: kept }` (cost cleared; the owner recomputes) |
| plan feature | acceptance | `skip`, `fm`; `feature.matrix = { id, version, keptMinutes, kept, skipped }` |

Row matching: `fm` tag → step id (`source.id` or `fm-<item id>`) → exact text. A skipped item that never had a row is
added nowhere. Returns the new targets plus a report `{ matrix, version, keptMinutes, skippedMinutes, targets,
perTarget, changes: [{ target, id, path, from, to }], summary }`; a second pass yields `changes: []`. The writer
persists the targets, then records `fm.apply(state, { action: 'applied', matrix, version })`.

### What changed in the other cores (all additive)

- `orchestrator@1` (`orchestrator-core.mjs`): steps carry `skip`; skipped steps leave `minutesLeft`, `nextUp`, phase
  completeness and the brief (`[skip]`); `progress().skipped`, `group.skipped`; new action `skip-step { id, step, skip }`.
- `pending@1` (`pending-core.mjs`): sub prompts keep `skip` and `fm`; `entryMinutes`, `splitCheck`, `stepsProgress`
  count only unskipped steps.
- `build-queue@1` (`build-queue-core.mjs`): small steps keep `skip` and `fm` (recordSteps + stepsAction).
- `change-log@1` (`changes-core.mjs`): steps keep `fm`.

## The console plugin (Opus phase, refactor-all s62–s67, Oct 29 2026) <!-- axf-plugin:feature-matrix -->

Plugin `apps/console-web/plugins/feature-matrix` (`ai.amberx.axf.console.feature-matrix`, built on Opus). <!-- axf-plugin:feature-matrix -->

| Piece | Where | <!-- axf-plugin:feature-matrix -->
| --- | --- | <!-- axf-plugin:feature-matrix -->
| Store + CLI | `matrix.mjs`: `list` · `state` · `get <id>` · `act '<change>'` · `seed '{ref, profile?}'` · `apply '{matrix}'` · `import [profile]` · `where` (`--json` for the server) | <!-- axf-plugin:feature-matrix -->
| Files | one per build profile, next to its orchestrator tracker: `_claude/builds/matrices.json` (main framework), `_claude/builds/profiles/<id>/matrices.json`; every save is mirrored to the plugin data folder through persist (`.axf-console/plugins/feature-matrix/matrices/<profile>.json`, on the hub's projects tree when mounted), which is also the read fallback. Apply reports: `reports.json` there (last 50). | <!-- axf-plugin:feature-matrix -->
| Draft | the pre-contract `feature-matrix@0` file (refactor-all, `keep` / `done` flags) is read as @1 by `web/draft.mjs` `fromDraft`: keep → keep/skip, done → a `done` history line (the contract has no done field), every item tied to the build step carrying its `[source step]` tag (so Apply finds it), dirty when the last edit is newer than the last apply. Written as @1 on the first save or **Import**. | <!-- axf-plugin:feature-matrix -->
| Server | `server/__init__.py` at `/api/plugins/feature-matrix/`: `GET state`, `GET matrix?id=`, `POST act` (refuses remove/delete), `POST seed`, `POST apply`, `POST import`; runs `matrix.mjs`; change-log entries (ref kind `change`) are read and written through `axf.changes@1` | <!-- axf-plugin:feature-matrix -->
| Page | Builds → Feature matrix: the matrices grid (DataGrid `feature-matrices`: build, profile, date added, time cost, kept / skipped, status, last applied; newest first) → each row opens its matrix (groups, tick keep / untick skip, Keep all / Skip all per group, add + inline edit, Fable/Opus totals, Rename, history drawer, Apply + what-changed report). A matrix a hook asks for that doesn't exist yet shows **Make its matrix** (seed). | <!-- axf-plugin:feature-matrix -->
| Reach | app menu **Builds ▸ Feature matrix** (next to Build orchestrator), Plugins ▸ Feature matrix settings, nav Builds, default right-click, the `builds.toolbar` slot button on the orchestrator, Pending builds, Build queue and Build manager pages, and every builds grid's row hook | <!-- axf-plugin:feature-matrix -->
| Settings | Settings → Plugins → Feature matrix (shared renderer, level toolbar): default order, row button in builds grids, open history with the matrix; Install & uninstall panel | <!-- axf-plugin:feature-matrix -->
| Tests | `test.mjs` (draft import against the repo copy, seeding, targets, CLI round trip on scratch files, repo files never written), `test.py` (manifest, server routes against fakes) | <!-- axf-plugin:feature-matrix -->

What Apply targets for each ref kind (`web/draft.mjs` `targetsFor`): orchestrator → the build + its `pendingId` item; pending → the item + the orchestrator build importing it; queue → the build-queue record; plan → the feature; change → the change-log entry (the server saves it through `axf.changes@1`). <!-- axf-plugin:feature-matrix -->

### Row hooks (grid-hook@1, lib-datagrid `datasets.ts`) <!-- axf-plugin:feature-matrix -->

A grid says what a row *is* (`DataGrid rowRef={(r) => ({ kind, id })}`; other lists draw `<RowHookButtons rowRef=… />` and map their context <!-- axf-plugin:feature-matrix -->
target with `registerRowRefTarget(target, payload → ref)`); a plugin registers `registerRowHook({ id, owner, label, icon, kinds, button, run })`. <!-- axf-plugin:feature-matrix -->
The row gets a button (unless `button` says no) and its right-click menu an item (`*:axf.row-hooks`, action `axf.grid.hook`). Neither side <!-- axf-plugin:feature-matrix -->
names the other. Forward-compatible with share-search's grid-attach@1 (hooks attach to entity kinds; `run` gets the dataset id). Wired in: <!-- axf-plugin:feature-matrix -->
orchestrator grid + cards (`orchestrator`), Pending builds (`pending`), Build queue (`queue`), Plan (`plan`), Build manager rows (their <!-- axf-plugin:feature-matrix -->
source) and sessions grid (`change`), Changes & features grid (`change` / `plan`). Android twin deferred (`framework/spec/PORTING.md`). <!-- axf-plugin:feature-matrix -->

### Not done <!-- axf-plugin:feature-matrix -->

- The windows-terminal scope list (claude.ai artifact db `scope/selection`) is not in the repo, so it was not imported; the refactor-all <!-- axf-plugin:feature-matrix -->
  draft (which already holds those items) is the first matrix. <!-- axf-plugin:feature-matrix -->
- The claude.ai matrix page (artifact db `matrix/refactor-all`) is not synced by the plugin; it still reads the db. <!-- axf-plugin:feature-matrix -->
