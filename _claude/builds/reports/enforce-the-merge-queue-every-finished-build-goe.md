# Enforce the merge queue: every finished build goes into it, batched into one build before CI

**Brett said (Nov 10 2026, 16:43):** "What happened to the merge queue? We need to start enforcing that. Everything needs
to go into the merge queue so we can make one build out of it before we send it to CI."

Build `enforce-the-merge-queue-every-finished-build-goe`, branch `claude/enforce-the-merge-queue-every-finished-build-goe`,
model Opus (no shared asset type, schema or cross-app contract changed: the queue's state is the push banner plugin's own
data; CI scope is CI config).

## What happened to the merge queue

It was running every 3 minutes, but it hadn't landed anything since **Nov 7 05:54** (#370). Every open PR was held out.

| Cause | Effect |
|---|---|
| On Nov 7 a "commit leftover work" commit on `claude/shipped-features-fable` brought back the retired `framework/plan/profiles/breakroom/` folder, and its `build_land` merge put it on main. | `builds-store.mjs verify` treated `breakroom` as a source and failed with 1,437 "breakroom" mismatches; `check-profiles.mjs` failed too. Main's own CI went red. |
| The light PR checks run `builds-store.mjs verify`. | Every PR's light checks went red, whatever the PR changed. |
| The queue only took PRs whose PR checks were green. | Queue length 0. On Nov 10, 17:00 it held 100 open PRs: about 40 with red checks, 17 with no checks, the rest held by UI Review, by hand or as drafts. |
| `autoLand` is off (Nov 4), so finished builds without a PR never got one. | Some finished builds never reached the queue at all. |
| The queue tested each PR on its own `queue/pr-<n>` branch. | Not what Brett asked for: one CI run per PR, not one per batch. |

The queue never said why it was empty: the console just showed "Nothing waiting to merge" and 100 "not in the queue" lines.

## What changed

| Area | Change |
|---|---|
| Main green again | `framework/cli/builds-store.mjs`: `gatherSources` skips `RETIRED_PROFILES` folders, so a merge that brings a retired folder back doesn't fail verify again. The stray `framework/plan/profiles/breakroom/` is deleted. `claude-accounts/help.json` entry 17 `kind: panel` → `control` (help-coverage was also red on main). |
| Batch mode (default) | `push-banner/land/merge-queue-core.mjs`: `batchMembers`, `batchHolds`, `decideBatch`, `greenFirst`, `QUEUE_MODES`, `BATCH_BRANCH`. `merge-queue.mjs` `batchRound`: up to `batchSize` ready PRs (default 8, 1–20) are combined into one commit on `queue/batch`. Builds files: newer wins; logs are unioned; generated files are regenerated. A PR that conflicts in code with the others waits for the next batch, and one that conflicts with main alone is kicked out with the files named. CI runs once on the batch. Green: main becomes that exact commit in one non-forced push, so GitHub marks every member PR merged, and the console redeploys once. If main moved meanwhile with status-only `[skip ci]` commits, those are merged in first, and the batch lands only if its code is still exactly what CI tested. Red: the batch is split in half until the one PR that broke it is found and kicked out (with a PR comment and a console alert); the halves that pass land. No model calls anywhere. |
| Everything goes in | `enlist`: every round, each finished build (land-core `isCandidate`) whose branch is on GitHub and has no PR gets one (up to 5 a round), whether auto-land is on or not. In batch mode, PRs with red or missing light checks still join, behind the green ones: the batch's full run is the real gate, so stale red checks from a broken main no longer keep a build out. Still held out: drafts, UI Review holds, hand holds and removals, PRs kicked out at the same head, and PRs whose checks are still running. |
| No way around it | Push banner **Merge** on AmberX-AXF with the queue on now puts the PR in the queue (`{queued: true}`) and never merges it directly. Auto-merge already left AmberX-AXF to the queue. Switching the queue off through the API is Brett's own signed-in click (403 otherwise). |
| CI | `queue/batch` is covered by `android.yml`'s existing `queue/**` trigger: a full, path-filtered run. A push to main whose code equals a green `queue/*` commit runs nothing again (`ci-scope.mjs queueTested` already looks at all `queue/*` refs). Comments updated. |
| Quieter | The queue no longer retries the repo variable `AXF_MERGE_QUEUE` every round after a 403: it waits an hour. `.github/merge-queue.json` already switches PRs to the light checks. |
| Stack mode kept | `queueMode: 'stack'` keeps the Nov 4 per-PR stack (its tests still pass) for when batches are too big to bisect cheaply. |

### Reconciled builds

- `auto-land-every-build-the-moment-it-finishes-red` (queued): note added. Its step 1 must not push each build to main; finished builds get a PR and go into the queue (enlist already does that), and the redeploy happens once per landed batch.
- `batch-manager` (pending): note added. Its grid should read the queue's batch (`GET /queue` → `batch`, `split`, `items[].inBatch`), and **Merge** on a row means "add to the queue".

## How each part is reached (API rule)

| What | Console (REST) | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|
| See the queue and the current batch | `GET /api/plugins/push-banner/queue` (`mode`, `batchSize`, `batch {prs, sha, ci, runUrl, bisect, why}`, `split`, `enlisted`, `items[].inBatch`) | `push_banner_mergequeue_list` | `node …/push-banner/land/merge-queue.mjs list` | "show the merge queue" → mergequeue-list (plugin-commands@1) |
| Mode, batch size, on | `POST /queue/settings {mode, batchSize, on}`, `PUT /config {queueMode, batchSize}` | `push_banner_mergequeue_settings` (new) | `merge-queue.mjs settings --mode batch --size 8 [--on]` | through the same plugin command |
| Add / remove / move a PR | `POST /queue/add`, `/remove`, `/move` (unchanged) | `push_banner_mergequeue_add/_remove/_move` | `merge-queue.mjs add|remove|move` | same |
| Open it | Builds menu → *Merge queue* (`action:push-banner.queue`), the banner's **Merge queue: N** chip, Settings → Plugins → Push banner | `console_show` / `console_open` target `action:push-banner.queue` | – | "open the merge queue" |

Settings → Plugins → Push banner → Auto-merge has two new controls: **Batch: one build, one CI run** (a switch) and
**PRs in one batch** (a select), both framework controls on theme tokens.

## Tests

| Check | Before | After |
|---|---|---|
| `land/merge-queue.test.mjs` | 11 | 17 passed. New: batch rules; a real-git round that builds a batch of 3 and opens a PR for a finished build with none; red batch → split → green half lands as the exact tested commit → batch of one red → kicked out, landed branches tidied; status-only main commits merged in before landing. |
| `land/land.test.mjs` | 92 | 92 passed |
| `push-banner/test.py` | 176 | 183 passed. New: batch default, setting bounds, Merge queues instead of merging, `/queue/settings`, off refused without Brett, MCP command present. |
| `framework/spec/check-ci-scope.mjs` | 10 | 10 passed |
| `builds-store.mjs verify` | **failed** (1,437) | ok, 15,235 checks |
| `framework/spec/check-profiles.mjs` | **failed** on main | ok |
| `ci-scope.mjs light --run` (all light PR checks) | **failed** | passed |
| help-coverage | **failed** (claude-accounts) | passed |
| check-theme, check-controls, check-toolbars | green | green |

Live dry run (real repo, nothing pushed, Nov 10 ~17:20): the first batch would be #398, #409, #412, #415, #416. #333,
#341 and #407 conflict in code with that batch and wait for the next one.

## How it goes live

Two PRs:

1. **#455 `claude/enforce-the-merge-queue-main-green`** (no UI): the main-green fixes only. Its light checks are green,
   so the queue already running on the VPS (stack mode) takes it, tests it once and merges it. From then on PRs pass
   their light checks again and the current queue starts landing.
2. **This branch** (batch mode + UI): a draft until the shots of Settings → Push banner (the Batch switch and batch
   size) and the queue's batch line are in UI Review. Once Brett approves, it goes through the queue like everything
   else. The console's auto-update deploys `/opt/axf`, and the next 3-minute round runs in batch mode with no manual
   step. The ~40 PRs that are red only because main was red then join batches.

## Known gaps

- UI Review shots aren't taken yet: this session had no way to render the console. Needed: Settings → Plugins → Push
  banner (Batch switch + PRs in one batch), and the merge queue view with a batch line. Desktop and phone.
- `menu-reach.mts` now sees nav entries in multi-line blocks and imported constants. `agent-voice` and
  `codebase-changes` reach their pages only through an `.open` action, not a `nav:` menu item. The "nav entry in the
  app menu" rule still uses the old one-line parse so this doesn't turn CI red; those two are left for their own builds.
- Another check that only fails locally: `test_wall_users.py` "the page itself" needs a built web bundle.

- Bisection costs about log2(batch size) extra runs for each broken PR in a batch. With the default of 8, that's at most 3 extra runs.
- `.axf-focus.json` (gitignored, written by the live-preview focus tool) makes `plugin-lifecycle check push-banner` flag a stale reference in local worktrees only. CI never sees it.
- `check-headless-tabs.mts` fails inside a Claude session's environment (it reads the session's own memory chain) and passes in a clean one (63/63). This is not a main issue.
