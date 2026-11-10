# Merge queue batching: ready PRs combined 5 at a time, one CI run, merged as one

**Brett said (Nov 10 2026):** "Every time we go to compile something it's changed so much that everything breaks. Take
all the pull requests as soon as they're ready, have the orchestrator combine them, like five at a time, into one big
build. Then pull main and merge it as one."

Build `merge-queue-batching-orchestrator-combines-ready`, Opus, branch
`claude/merge-queue-batching-orchestrator-combines-ready`. Amends the merge queue (push banner `land/merge-queue.mjs`,
build `merge-queue`) that `enforce-the-merge-queue-every-finished-build-goe` makes mandatory.

## What changed

| Step | What |
|---|---|
| s1 runner | New **batch mode**, the default (`queueMode: "batch"`, `batchSize: 5`, 1-10). Each round (the existing 3-minute auto-land cron, same lock, no new cron): the next 5 ready PRs in queue order are merged one after another onto the **latest main** in a temporary worktree (builds files newer-wins, logs unioned, generated files regenerated: the same data rules as before), pushed as `queue/batch-<n>`, and CI runs **once** on it (`android.yml` already runs on `queue/**`). Green: a PR `queue/batch-<n>` → main is opened (only now, so the batch never pays for PR checks) and merged with the tested head pinned; if GitHub can't merge it as is, latest main is pulled into the batch and that commit is merged as long as its code equals what CI tested. Every PR in it is then closed with a "Landed in main in batch n" comment and its branch deleted. One merge, one deploy. |
| s1 red batch | A red batch of several is **halved**: the first half is the next batch; a green half merges, a red half is halved again, a red batch of one is the PR at fault and is kicked out (comment, alert, view; a new commit rejoins). |
| s1 conflicts | A PR that conflicts in code with main is kicked out (as before). One that conflicts with a PR earlier in its batch waits for the next batch. **AI fallback** (`batchAiResolve`, off by default): the queue still never calls a model itself (the zero-token guard in `land.test.mjs` holds); it sends one agent job, new job type `queue-conflict` (Opus, via `framework/cli/agent-job.mjs`, once per PR head), that makes the PR's branch work with the others and pushes it. The new head rejoins and CI decides. |
| s1 stack mode | The Nov 4 queue stays as `queueMode: "stack"` (all its tests run in that mode). |
| s2 settings + API | Push banner 0.8.0. Config keys `queueMode`, `batchSize`, `batchAiResolve` (server-validated). REST `GET/POST /api/plugins/push-banner/queue/settings` ({on, mode, batchSize, aiResolve, depth}); `GET /queue` now carries `mode`, `batchSize`, `batch` (PRs, sha, base, CI, run, PR), `suspects`, `batches`. MCP / console actions through plugin-commands@1: `push_banner_mergequeue_settings`, `push_banner_mergequeue_set` (+ the existing list / add / remove / move). CLI `node apps/console-web/plugins/push-banner/land/merge-queue.mjs settings [--mode batch|stack] [--size N] [--ai on|off] [--queue on|off]`; `list` prints the mode first. Voice: AmberX reaches the same commands through control@1's plugins domain (plugin-commands@1 registry), e.g. "set merge queue batch size to 3". |
| s2 view | Settings → Plugins → Push banner (deep link `/settings/plugins/push-banner`), under the Merge queue switch: *How the merge queue tests PRs* (Batch / Stack), *PRs per batch* (1-10), *AI fallback for code conflicts inside a batch*. The Merge queue view (banner chip, Builds menu → Merge queue) shows the batch under test (its PRs, base, state, run, PR), each row "batch n with #a, #b…", and the last batches with their result. Framework controls and theme tokens only. |
| CI | `ci-scope.mjs` already matched every `queue/*` branch for the "main already tested" skip; doc lines updated. |

## Tests

| Check | Result |
|---|---|
| `land/merge-queue.test.mjs` | 20 passed (was 11): batch settings, pick / hold / decide / halving rules, and real-git rounds with a fake GitHub: 5 PRs into one branch while #6 waits; a builds-live commit on main keeps the batch (no second run); green batch = **one** merge into main for 5 PRs, all 5 closed as landed; in-batch code conflict waits; red batch of 2 halved, green half merges, red one kicked; AI fallback sends one agent job per head; CLI settings bounds |
| `land/land.test.mjs` | 92 passed (zero-token guard included) |
| `push-banner/test.py` | 181 passed (+5: batch defaults, bounds, settings land on config, unknown keys refused, `/queue` mode) |
| `framework/spec/check-ci-scope.mjs` | 10 passed |
| console `tsc --noEmit`, check-theme, check-controls, check-toolbars, check-chrome-assets | green |
| help coverage | push banner's 4 new controls covered; the run fails on `claude-accounts/help.json` entries[17] (not touched here, on main already) |

## Known gaps

- **UI Review:** the session's live preview wasn't running (port closed), so no desktop / phone shots were taken; the
  settings block and batch line still need their UI Review item before the PR counts as ready.
- **Required checks after pulling main in:** if branch protection requires checks and main had to be pulled into a
  green batch, GitHub wants a run on the new head first; the queue then waits for that run (the batch stays, says
  why in the view). Same constraint the stack mode had.
- Members of a merged batch are closed by the queue if GitHub doesn't mark them merged itself (it does when their head
  commits reach main).
- `plugin-lifecycle check push-banner` flags the session's untracked `.axf-focus.json` (gitignored, written by `axf focus`).
