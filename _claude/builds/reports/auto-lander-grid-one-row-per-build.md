# Auto-lander grid: one row per build, behind-main count, archive

Brett (Nov 16 2026 19:19): "You need to fix that grid, make it one row. I need to see everything waiting to be merged and how far behind main."

## What changed

**Gate & rules → Auto-lander tab, "Waiting to merge" grid** (`grid:gate.waiting`, lander-grid@1)
- One row per build (deduped by build id), exactly three columns: **PR**, **Build**, **Behind main** (commits). Each header sorts on tap; default is most behind first.
- Second line under the name only when the two-row layout is on: what it does · why it is blocked. One line, ellipsised.
- Everything not merged: every land.json entry (ready, waiting, settling, blocked) plus merge-queue entries. Archived, deleted and complete builds never show.
- Stale records (no PR and no branch on GitHub) are hidden by default: **Show stale** switch, **Clean stale** button (drops them from land.json).
- Filter field: `behind > 500`, `behind<10`, `pr:712`, `held`, `stale`, or words (build / title / why / branch).
- Row menu (`button:gate-row-menu-<build>`): Open PR, Merge main + fix, Hold / Release, Archive.
- **Select** → tap rows → **Archive N** (bulk, confirm).
- Behind counts come from `git rev-list --count <branch>..origin/main` on the console's checkout (the lander fetches every round), cached by (main sha, branch sha) in the gate's `behind.json`: about 1 s cold for 40 branches, near zero after.

Live data at build time: 40 builds waiting, 158 stale records hidden, worst is #634 at 2592 commits behind.

**Archive anywhere (s4)**: `framework/cli/archive-pr.mjs` `afterArchive()` runs after every archive: orchestrator `act archive` (and `act status … archived`), the Build manager pipeline `archive` action, and the grid (which archives through the orchestrator). It runs `land.mjs archive <build>` detached: the build leaves land.json at once and its open PR gets a comment ("archived … branch kept") and is closed. The branch is never deleted. Scratch stores (tests: `AXF_BUILDS_STORE` / `AXF_ORCH_FILE`) never touch real PRs; `AXF_ARCHIVE_PR=off|sync` overrides.

## How each piece is reached

| What | REST (`/api/plugins/gate`) | MCP | CLI | Voice / console action |
|---|---|---|---|---|
| Grid | `GET lander/grid?filter&sort&dir&stale` | `lander_grid` | `axf gate lander grid [--filter …] [--sort pr\|build\|behind] [--dir] [--stale]` | `lander.grid[:filter]` |
| Open | row `url` | row `url` | grid output | `lander.row.open:<build\|pr>` |
| Merge main + fix | `POST lander/merge-main {build}` | `lander_merge_main` | `axf gate lander merge-main <build\|pr>` | `lander.row.merge-main:<build>` |
| Hold / Release | `POST lander/hold {build, on?, why?}` | `lander_hold` | `axf gate lander hold\|release <build>` | `lander.row.hold:<build>[:off]` |
| Archive (bulk, confirm) | `POST lander/archive {builds, confirm?}` | `lander_archive` | `axf gate lander archive a,b [--confirm t]` | `lander.row.archive:<a,b>` (destructive: console confirms) |
| Clean stale | `POST lander/clean` | `lander_clean` | `axf gate lander clean` | button `gate-clean-stale` |

Deep link: `gate.open:auto-lander` / `view:gate` → Auto-lander tab. Every action is logged in the gate History (kind lander).

## Tests
- `apps/console-web/plugins/gate/test.mjs`: 24 checks (new: grid rows/sort/filter/stale/archived, hold/release/merge-main/archive with confirm, CLI = API parity for the grid).
- build-orchestrator `test.mjs` 35, `pipeline.test.mjs` 52, push-banner `land.test.mjs` 110, `merge-queue.test.mjs` 18: green.
- `tsc --noEmit` (console-web), `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: green. Control inventory regenerated.
- `check-console-control` reports one tab group without an address in `plugins/claude-settings/web/index.tsx:234`: already there before this build, not touched here.

## Not done / notes
- No screenshot: the console was not rebuilt in this session (heavy step), so the grid was checked through tsc and the API against live data only.
- "Merge main + fix" starts the lander's `merge-main` (generated files resolved); code conflicts go to the lander's fix agent on its next round, as today.
