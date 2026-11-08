<!-- memory-chunk@1 source=_claude/memory/docs/feature-matrix.md tokens=304 -->
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
