<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md lines=17-26 tokens=193 -->
## Removed
- The Opus plugin folder was removed first with its `uninstall.mjs --all`
  (commit `468df70`): folder deleted, the three marked doc lines stripped, `plugin-lifecycle.mjs check --after-uninstall`
  clean. The new build was then installed in the same folder.
- `server/inventory.py` no longer contains its own resolver (`_providers`, `_dependencies`, `_dependents`, `_health`,
  `_conflicts`); it gathers facts and calls the shared engine.
- `web/model.ts`: the hand-written offline inventory, `webConflicts()` and the duplicated health/label tables are gone
  (the engine and `installedLibraryRecord` replace them). `web/views.tsx`: the hand-laid graph columns are gone
  (`pluginGraph` from the engine lays it out; the view only maps columns/rows to pixels).
