<!-- memory-chunk@1 source=_claude/memory/docs/feature-matrix.md lines=41-52 tokens=227 -->
## Actions (`fm.apply(state, change, now?)`)

`add` (refuses a duplicate) · `seed` (adds the matrix when missing, then only the items it lacks: idempotent; existing
items are never touched by a reseed) · `add-item` (an existing id = **restore**: back to keep + merge the fields given)
· `keep` / `skip` / `set-state` · `edit-item` (name, why, group, minutes, model) · `rename` · `applied` (version ≤
current; records appliedAt) · `remove-item` and `remove` **always throw**. Every change returns `{ state, matrix, item,
log }`; pass `now` for reproducible output.

Seed helpers turn what a build already has into items (nothing invented): `itemsFromSteps` (orchestrator steps, source
`step`), `itemsFromSubPrompts` (pending sub prompts / queue small steps, source `sub`), `itemsFromAcceptance` (plan
acceptance lines). They read the `skip` and `fm` tags Apply writes, so seeding after an Apply round-trips.
