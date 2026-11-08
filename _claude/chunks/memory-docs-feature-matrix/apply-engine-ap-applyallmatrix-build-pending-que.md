<!-- memory-chunk@1 source=_claude/memory/docs/feature-matrix.md lines=53-69 tokens=314 -->
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
