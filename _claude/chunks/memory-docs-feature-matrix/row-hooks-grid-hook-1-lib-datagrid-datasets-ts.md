<!-- memory-chunk@1 source=_claude/memory/docs/feature-matrix.md tokens=285 -->
### Row hooks (grid-hook@1, lib-datagrid `datasets.ts`) <!-- axf-plugin:feature-matrix -->

A grid says what a row *is* (`DataGrid rowRef={(r) => ({ kind, id })}`; other lists draw `<RowHookButtons rowRef=… />` and map their context <!-- axf-plugin:feature-matrix -->
target with `registerRowRefTarget(target, payload → ref)`); a plugin registers `registerRowHook({ id, owner, label, icon, kinds, button, run })`. <!-- axf-plugin:feature-matrix -->
The row gets a button (unless `button` says no) and its right-click menu an item (`*:axf.row-hooks`, action `axf.grid.hook`). Neither side <!-- axf-plugin:feature-matrix -->
names the other. Forward-compatible with share-search's grid-attach@1 (hooks attach to entity kinds; `run` gets the dataset id). Wired in: <!-- axf-plugin:feature-matrix -->
orchestrator grid + cards (`orchestrator`), Pending builds (`pending`), Build queue (`queue`), Plan (`plan`), Build manager rows (their <!-- axf-plugin:feature-matrix -->
source) and sessions grid (`change`), Changes & features grid (`change` / `plan`). Android twin deferred (`framework/spec/PORTING.md`). <!-- axf-plugin:feature-matrix -->
