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

## Before / after: #733 (green → red)

PR #733 (`to-do-manager-fully-voice-mcp-controlled`) was green. The auto-lander then committed
`commit synced files left in the worktree (auto-land)` on its branch: the worktree's stale copies of
`store.json`, `orchestrator.json`, `origins.json` and the open 70 MB journal part. The branch now carried an old
snapshot of live build status, the PR diff touched tracking files main rewrites every few minutes, and CI went red; it
took a revert commit to get it back. Every finished build's worktree had the same files dirty, so the same thing was
waiting to happen to each of them.

After this build:

| Where | Before | After |
|---|---|---|
| Lander worktree clean (`land.mjs cleanWorktree`) | tracking files committed with the build's other synced files | tracking files reset to the merge-base copy with main (`resetTracking`); ones the branch committed are undone in one reset commit; other synced files (reports, memory) still committed |
| Build session writes (`builds-store.mjs`) | store, origins and orchestrator exports rewritten in the checkout | in a build worktree they live on the hub: `/projects/amberx-axf/_data/builds/worktrees/<worktree>/` (`AXF_BUILDS_HOME=repo` keeps the old place); the status-only publish to main is unchanged |
| Headless sessions (`deploy/claude-headless.sh`) | nothing kept them out of `git add -A` | `framework/cli/worktree-setup.mjs guard`: skip-worktree on the tracked ones, `info/exclude` for the rest |
| Lander / merge queue / vps.build_land merges | builds files newer-wins by the driver; pending/queue main's copy | every tracking file takes main's copy (main deleted it = it goes) and the merge goes on |
| Generated files | main's copy + regenerate (already) | also: a unioned catalog status reruns the tracker (`then` in generated-files@1) |
| Journal | 916 MB in git, 13 parts, rewritten by every status commit | on the hub data store (`/projects/amberx-axf/_data/builds/journal`), pointer `_claude/builds/journal.json` with per-part sha256; parts untracked (`git rm --cached`), `_claude/builds/journal/` git-ignored; history/restore/verify read the hub (+ the repo's old parts as fallback) |
| CI | checks could read the real journal | fixture journal (`framework/spec/fixtures-journal/`); `check-tracking-files.mjs` fails a PR that changes a tracking file outside a status commit, naming the file and the fix |

Journal moved: 13 parts, 960,321,916 bytes copied (916 MiB on the hub), every repo line verified on the hub before the
parts were untracked; `builds-store.mjs journal verify` checks the hub against the pointer.

## The one list

`framework/core/tracking-paths.mjs` (tracking-paths@1): store, orchestrator (+ profiles), origins, journal parts,
`framework/plan/pending.json`, `framework/plan/build-queue.json`. Read by land-core, the lander, the merge queue, the
worktree guard, the CI guard and (through `worktree-setup.mjs paths --json`) the Python resolver.

## API reach (tracking-file handling)

- REST: `GET /api/plugins/push-banner/land/tracking[?build=]`, `POST /api/plugins/push-banner/land/tracking/show {show}`
- MCP / AmberX voice: plugin commands `land-tracking` ("what did the lander do with the tracking files"),
  `land-tracking-show` ("show the tracking files on the merge queue")
- CLI: `land.mjs tracking [<build>] [--json]`, `land.mjs tracking-show on|off`; `worktree-setup.mjs guard|clear|status|paths`;
  `builds-store.mjs journal migrate [--apply] | verify | status`; `check-tracking-files.mjs`
- Console: Settings → Plugins → Push banner → "Show tracking-file handling on the merge queue"; merge queue rows carry
  `data-axf-row=<build>`; `console_show function:push-banner.queue` opens the queue

## Left for later

- After this PR lands, run `node framework/cli/builds-store.mjs journal migrate --apply` once more on the VPS: lines the
  main checkout's old code wrote to its repo journal between this migration and the landing get unioned onto the hub
  (it only adds lines; the main checkout's journal files go when the pull removes them).
- The live publisher does not refresh `journal.json` yet (verify uses the open part's floor, so it stays valid as the hub
  grows); the `axf-builds` merge driver does not merge the pointer per part yet.
- Spool mode (no hub mounted: CI, cloud sessions) keeps journal lines local; draining them through the build-orchestrator
  plugin API (`POST /journal/append`) is the design's next step.
- Git history still carries the 916 MiB (Pending item `shrink-git-history-drop-old-builds`).
- The stale claude-sync copy at `/projects/amberx-axf/_claude/builds/journal/` (325 MB) can go (axHub veto delete).
- Disk on the VPS is at 98% (11 GB free); the systems check's disk item covers it.
