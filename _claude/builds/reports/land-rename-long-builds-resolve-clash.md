# land-rename-long-builds-resolve-clash

Lands `claude/rename-long-builds` (PR #617, build-renames@1) on top of current main. This PR contains every commit of #617; landing it closes #617.

## s1: clash in orchestrator.mjs
Main had added build aliases (build-id@1, `resolveId(store, id)`); the branch added old-id renames (`resolveBuildId(id)` over `_claude/builds/renames.json`). Both were kept and chained: an id goes through renames first, then through aliases.
- `act()` resolves `change.id` by rename always, by alias outside legacy (`AXF_ORCH_FILE`) mode, as main did.
- The CLI's `next`, `brief` and `request-upgrade` resolve their id the same way (main's `request-upgrade` coverage kept).
- The header doc keeps both lines.

## s2: the renames
- All 39 entries in `renames.json` point at ids that are live in main's store. No old id is still a live build, and no new id clashes with another build's alias.
- `build-rename.mjs plan` finds nothing left to rename: the 8 long-named worktrees still on disk are landed builds and are skipped.
- An old id still resolves: `orchestrator.mjs brief focus-on-every-screen-console-open-console-show-` answers for `focus-every-screen-console-open-console`.

## Tests
- `build-orchestrator/test.mjs`: 35 passed
- `build-orchestrator/build-id.test.mjs`: 7 passed
- `build-orchestrator/pipeline.test.mjs`: 46 passed
- `build-orchestrator/test.py`: 41 passed
- `framework/spec/check-build-renames.mjs`: 12 passed

## API / UI
No UI was added or changed. Renames are reached through `node framework/cli/build-rename.mjs plan|apply|resolve`, and every orchestrator command or action that takes a build id accepts the old id.
