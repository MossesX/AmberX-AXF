# Fix the orchestrator's splitter (fix-the-orchestrator-s-splitter-claude-print-get)

Brett said (2026-11-10 16:47): "You're the one who knows. Tell me what's wrong."

## What was wrong, by cost

| # | Problem | Cost | Fixed here |
|---|---------|------|------------|
| 1 | **Splitter never reached Claude.** `claude -p … --tools '' <prompt>`: `--tools <tools...>` is variadic, so it took the prompt as a tool name and claude exited 1 with "Input must be provided either through stdin or as a prompt argument when using --print". | Every split fell back to rules (one step per line, 3 steps for most builds): RESPLIT_COUNT unstarted builds carried rule-made steps. | Yes: the prompt goes on stdin (`P.oneShotArgs`), and those builds were re-split by Claude. |
| 2 | **Fable probe had the same bug.** `probe()` used the same argv, so every probe would have recorded `fable: false` for 7 days. | No account had been probed yet, so nothing was mislabelled. | Yes: same fix. |
| 3 | **Shipping stalled for 37 h.** `shipLanded` took the first 3 landed builds each tick. Three of them (profile-manager, amber-chat-asset, build-pipeline-v2) have no landed commit, PR or merge time, so their manifest is rejected. They failed every minute and nothing behind them shipped. | 4,084 `ship-failed` lines in 48 h (81 % of the dispatcher log); no shipped manifest since Nov 9 04:31. | Yes: a failed build is skipped until its record changes (state.json `shipFailed`, key `P.shipKey`), so the slots go to the builds behind it. |
| 4 | **Disk filled; launches failed with "unable to write file _claude/builds/journal/*.jsonl".** Build worktrees were never removed: 236 of them, 121 GB. The journal files were simply the first big files a new checkout writes ("No space left on device" in the same errors). | 8 launch failures on Nov 10 04:45 to 06:16; 10 ENOSPC ship and snapshot failures; torn lines in log.jsonl; leftover tmp objects in /opt/axf/.git. | Yes: `pruneWorktrees` + `ensureRoom` (see below). |
| 5 | **Half-written store read.** builds-live wrote the console checkout's 4 MB `store.json` (and exports, journals, origins, shipped manifests) in place, and the dispatcher read it mid-write. | "Unterminated string in JSON" / "Unexpected end of JSON input" errors in ship, self-check and tick hooks about every few hours. | Yes: those writes now go through a temp file and a rename (`writeAtomic`). |
| 6 | **The builds journal lives in git.** `_claude/builds/journal/` is 232 MB, gets about 800 commits a day, and is checked out into every worktree (about 55 GB of the 121 GB). | Disk, clone and checkout time, and repo growth. | No: moving it out of git changes builds-live and the merge driver. Recommended as its own build. |
| 7 | **Throughput is capped low.** agent-slots `maxAgents` is 3 (default 6), with 22 GB RAM free. Only `mossesx-max-` takes work; `account-3` (Fable, 5 parallel) is "not a worker", so it sits idle. | 17 queued builds wait for 3 slots ("queued builds wait, nothing launched" 216 times in 48 h). | No: these are Brett's settings. To change them: `node framework/cli/agent-slots.mjs` settings `maxAgents` 5 or 6, and add account-3 to the workers. |
| 8 | **11 legacy `x.*` plan records stuck in "running".** They have no pipeline record and no session, so the stale reaper skips them. | The "Building" table shows them as running. | No: they are legacy plan rows; archive them or mark them done. |

## Changes

- `pipeline-core.mjs`: adds `oneShotArgs(model)`, which builds argv with no prompt in it. Adds `pruneVerdict` and `shipKey`. Adds `SESSION_FILE` and `STORE_CHURN`, the paths that don't count as real work.
- `pipeline.mjs`:
  - `askSplitter` and `probe` pass the prompt on stdin. `AXF_CLAUDE_BIN` overrides the binary for tests.
  - `pruneWorktrees({ apply })` removes a worktree only when nothing would be lost:
    - the build has been built, complete or archived for at least 24 h;
    - no tracked change apart from the builds store files (which builds-live already publishes to main) and root logs;
    - no untracked file other than session logs;
    - HEAD is on a branch.
  - What a prune keeps and moves: the branch and its commits stay in the repo, and the brief and logs move to `/root/axf-builds/_session-logs/<id>/`.
  - `ensureRoom()` runs before every new worktree. Below 30 GB free (`AXF_PIPELINE_MIN_FREE_GB`) it prunes. Below 3 GB it refuses with "disk full: … free space on the VPS" instead of a wall of git errors. The self-check also prunes when free space is under the floor.
  - `ensureWorktree` reuses an existing `claude/<id>` branch as it is. Before, `-B` would have reset it to main when a pruned build ran again.
  - New CLI command: `pipeline.mjs prune-worktrees [--apply] [--min-age-h 24] [--json]`. It is a dry run unless you pass `--apply`.
  - The after-tick ship hook remembers builds that failed to ship.
- `framework/cli/shipped.mjs`: `shipLanded({ skip })`.
- `framework/cli/builds-live.mjs`: `writeAtomic` for every write into the console checkout.

The prune did not run on the live disk: 182 GB is free, which is above the floor, so nothing needed it. A dry run today would remove 23 finished worktrees. The other 201 are kept: unfinished or recent builds, real uncommitted work, or worktrees with no build record.

## Re-split

RESPLIT_DETAIL

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 43 checks, all passing. New checks:
  - `oneShotArgs`: nothing comes after `--tools ""`.
  - e2e: a fake `claude` that parses argv the way the real CLI does (variadic `--tools`, fails with the exact error when there is no prompt). The split now comes back from Claude, and the prompt is not in argv.
  - `pruneVerdict` cases.
  - e2e on real git worktrees: the clean finished worktree is removed, its branch and logs are kept, and the dirty one stays.
  - e2e: a landed build with no commit fails to ship once, is skipped on the next tick, and is tried again after its record changes.
- `node framework/spec/check-shipped-manifest.mjs`: 35 checks passing.
- `node framework/spec/check-builds-live.mjs`: 62 checks passing.
- Live check: the real `claude` CLI with `oneShotArgs(opus)` and the prompt on stdin exits 0 and returns JSON. The old argv reproduces the error.

## API

There is no UI change. Pruning is reachable from the CLI (`pipeline.mjs prune-worktrees`). The self-check (console Orchestrator → self-check, `pipeline.mjs selfcheck`, MCP/voice through the existing self-check action) and every launch run it on their own when disk is low. Splits stay on `pipeline.mjs split <id>` and on the console's split request.
