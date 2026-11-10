# Merge queue: a red batch is split, the good PRs merge, the bad one goes back to its build

**Brett said (Nov 10 2026):** "That's the way to do it, right? Why do I have to figure this shit out on my own?"

Yes, that is the way to do it (it's how bors and GitHub's own merge queue handle a red batch). It is now automatic and on by
default, so nobody has to work it out by hand.

Build `merge-batching-add-on-when-a-batch-fails-ci-spli`, Opus, branch `claude/merge-batching-add-on-when-a-batch-fails-ci-spli`.
Amends the batch mode from `merge-queue-batching-orchestrator-combines-ready` (#457, not merged yet). This branch has
#457 merged in, so this PR **contains #457** and should land after it, or together with it in one batch.

## What changed

| Step | What |
|---|---|
| s1 split | #457 already halved a red batch. Now the whole split is tracked from start to finish (`bisect` in `merge-queue.json`: the red batch, its PRs, runs spent, merged, sent back). Plain code, no model: the first half of the suspects is tested; a green half merges, a red half is split again, a red batch of one is the PR to blame. |
| s1 send back | The PR to blame is **sent back to its build**: one agent job, new job type `queue-fix` (Opus, through `framework/cli/agent-job.mjs`, the same capability path `queue-conflict` uses), gets the PR, branch, build, failed jobs and red run. It fixes the branch, pushes, and adds a note on the build. The new head rejoins the queue by itself and is **retested**. Once per PR head, at most `batchFixTries` (default 2) per PR; after that the PR stays out and Brett gets an error alert. If the agent finds the failure isn't the PR's fault (main red, flaky job), it pushes nothing and says so. |
| s1 AmberX | Alerts through the console alert hub (warning and worse reach AmberX, per notify-control): "batch n failed CI, splitting it" when a batch goes red; "#x broke batch n, sent back" per PR (error when tries are used up or auto-fix is off); one summary when the split is finished (what merged, what went back, runs spent). The PR's alert resolves when it lands. Every alert links to `/settings/plugins/push-banner`. |
| s1 job types | `queue-fix` and `queue-conflict` now list their tools (Read, Edit, Write, Grep, Glob, Bash). Without the list a job agent got the agent's default read-only tools and could not push, so the #457 AI fallback could not have worked. |
| s2 settings | Push banner 0.9.0. Config `batchAutoFix` (on by default), `batchFixTries` (0-5, default 2), validated on the server. |
| s2 API | REST `GET/POST /api/plugins/push-banner/queue/settings` takes `autoFix`, `fixTries`; `GET /queue` carries `autoFix`, `fixTries`, `bisect`, `bisects`, `fixJobs`. MCP / console actions (plugin-commands@1): `push_banner_mergequeue_settings`, `push_banner_mergequeue_set` (new inputs), `push_banner_mergequeue_list`. CLI: `node apps/console-web/plugins/push-banner/land/merge-queue.mjs settings --fix on\|off --tries N`; `list` prints the running split. Voice: AmberX reaches the same commands through control@1's plugins domain, e.g. "turn off merge queue auto-fix", "set merge queue fix tries to 1". |
| s2 view | Settings → Plugins → Push banner (deep link `/settings/plugins/push-banner`): switch *Send the PR that broke a batch back to its build for a fix* and *Fix tries per PR*. Merge queue view: a status line while a red batch is being split (merged, sent back, still to test, red run link), the sent-back line under each kicked-out PR, and the last red batches with their outcome. Framework controls and theme tokens only. |

## Tests

| Check | Result |
|---|---|
| `land/merge-queue.test.mjs` | 23 passed (was 20). New: send-back rules (once per head, tries, off) and bisect tracking / alerts; end to end with real git and a fake GitHub: a red batch of 5 with one bad PR → [13 14 15] green merges, [16] red is sent back (one queue-fix job, PR comment, warning alerts, summary), [17] green merges; the fixed head of #16 rejoins, is retested and merges, its alert resolves; tries used up → no third job, error alert "waits for Brett" |
| `land/land.test.mjs` | 92 passed (zero-token guard holds: the queue never calls a model) |
| `push-banner/test.py` | 185 passed (+4: send-back defaults, bounds, settings land on config, `/queue` fields) |
| console `tsc --noEmit`, check-theme, check-controls, check-toolbars, check-chrome-assets | green |
| `agent-job.mjs queue-fix --dry-run` | brief renders, tools Read, Edit, Write, Grep, Glob, Bash |

## Known gaps

- **UI Review:** this worktree had no live preview running, so there are no desktop or phone shots yet (#457 had the same gap).
  The settings block and the split line need a UI Review item before this PR counts as ready.
- **Stack mode** (`queueMode: "stack"`) still only kicks a red PR. It doesn't send it back. Batch mode is the default.
- **Interaction failures:** if two PRs only fail together, splitting them merges the first one. The second is then tested on
  the new main, fails there and is sent back, which is the right PR to fix.
- `plugin-lifecycle check push-banner` flags the session's untracked `.axf-focus.json`, which is gitignored and written by `axf focus`.
