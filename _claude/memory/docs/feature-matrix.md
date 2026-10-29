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

## Left for the Opus phase (s3–s8)

Where the dataset file lives (plugin `lifecycle.dataDir`, mirrored to the hub), the server API (list / get / add /
keep / skip / edit / apply; no delete), seeding from a build's steps, the matrix view and the matrices grid, the hooks
in every builds grid through a grid-hook registry compatible with share-search's `grid-attach@1`, the windows-terminal
scope-list import (artifact db `scope/selection`) as the first matrix, lifecycle scripts, shots, report, PR.
