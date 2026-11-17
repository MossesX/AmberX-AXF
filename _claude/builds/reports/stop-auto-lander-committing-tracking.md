# Stop the auto-lander committing tracking files into builds

## Where tracking files got committed (s2)

One place: `apps/console-web/plugins/push-banner/land/land.mjs` `cleanWorktree`, commit
`<build>: commit synced files left in the worktree (auto-land)`. `land-core.mjs strayPlan` sent every dirty path
under `_claude/` (SYNCED) to `commit`, so a finished build's worktree had these staged on its own branch:

- `_claude/builds/store.json`
- `_claude/builds/orchestrator.json` (and `_claude/builds/profiles/*/orchestrator.json`)
- `_claude/builds/origins.json`
- `_claude/builds/journal/*.jsonl` (the open part, ~70 MB each)
- `framework/plan/pending.json`, `framework/plan/build-queue.json` (via `framework/plan/` in SYNCED)

The merge queue (`merge-queue.mjs`) and the vps.build_land resolver (`framework/cli/land-resolve.py`) only commit
merges; they never stage stray worktree files.

The one list now lives in `framework/core/tracking-paths.mjs` (tracking-paths@1); land-core's builds-file rule reads it.
