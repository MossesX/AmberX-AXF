# Show commits behind main on every build table and the orchestrator

Brett said (Nov 12 2026): "We need, I need, um, I need all the build tables and the orchestrator to, um, list how many commits they are behind main."

## What it does
- Every build row and orchestrator card carries `behindMain` / `aheadMain` (git rev-list counts of the build branch against `origin/main`).
  Source: `framework/cli/branch-drift.mjs` (branch-drift@1), cached per (main sha, branch sha) in the git common dir and updated incrementally when main moves.
  The dispatcher tick fetches `origin/main` at most once a minute, so a main push shows within a minute.
- Tables:
  - Build orchestrator → All builds: sortable **Behind main** column and filter (any, behind, far behind, up to date, no branch).
  - Builds page: sortable column and filter.
  - Pipeline tabs (Pending, Queued, Building): "Sort by behind main" toggle and filter.
  - Merge queue (landing queue): a chip on every row (in line, kicked out, not queued) that links to the compare view.
- A count of 50 or more is far behind and shows as a warning chip. A build with no branch shows a dash.
- The expanded row shows ahead / behind, **Compare with main** (GitHub compare view), **Pull in main** (the dispatcher merges main into the worktree and pushes; a conflict is aborted and noted) and **Rebuild** (Pending only: queues the build).

## API (UI, REST, MCP, CLI and voice all reach the same thing)
| What | REST | MCP | CLI |
|---|---|---|---|
| Every build's drift | `GET /api/plugins/build-orchestrator/pipeline/drift` | `pipeline-drift` | `node apps/console-web/plugins/build-orchestrator/pipeline.mjs drift` |
| One build | `GET …/pipeline/drift/{id}` | `pipeline-drift-get` | `pipeline.mjs drift <id>` |
| Pull in main | `POST …/pipeline/pull-main {id}` | `pipeline-pull-main` | `pipeline.mjs pull-main <id>` |
| Build lists | `GET …/pipeline`, Builds page list: rows carry `behindMain` / `aheadMain` / `compareUrl` | as the list commands | `builds.mjs` list |
| Merge queue | `GET /api/plugins/push-banner/queue`: items carry `behindMain` / `aheadMain` / `compareUrl` | `mergequeue-list` | `merge-queue.mjs list` prints "N behind main" |
| Raw counts | | | `node framework/cli/branch-drift.mjs [branch…] [--json]`, `… refresh` |

Voice (AmberX) reaches the same MCP commands: "how far behind main are the builds", "how far behind main is skins".
Deep links: the orchestrator and Builds page console_open targets, as before. The filter and sort choices are kept per device.

## Tests
- `pipeline.test.mjs` (drift fields on rows) passes.
- `merge-queue.test.mjs` passes 19 checks, including the new one: one branch-drift call per round, and a dash when there is no branch or the count fails.
- `land.test.mjs` passes 94 checks. The land scripts stay self-contained: branch-drift runs as a script, not an import.
- `tsc --noEmit`, check-theme, check-controls, check-toolbars, check-chrome-assets and plugin-lifecycle (push-banner) all pass.

## Open
- UI Review shots: the headless capture (`rebuild-shots.mjs`) could not reach axHub from the build sandbox, so every screen rendered "Waiting for axHub". The PR stays a draft until desktop and phone shots of All builds, the pipeline tabs, the Builds page and the merge queue are in UI Review.
- No Android twin (no new Kotlin work).
