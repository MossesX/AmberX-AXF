# Merge queue: test once, never twice (`merge-queue`, Current profile)

**Brett said (voice, Nov 4 2026):** "How do we prevent this from happening? Things get added to main before it gets
merged, so it has to do it again. We're paying to do these CI checks twice." … "Two things being checked at the same
time - if one finishes and merges, the other one is corrupted?" … "Yeah, do that. And how am I going to access this
merge queue?"

Branch `claude/merge-queue`. Model: Opus for every step (no shared asset type, schema or cross-port contract changed:
the queue's state is the push banner plugin's own data, CI scope is CI config). UI Review item `r-20261104-d7a77e5c`.

## Native or our own

**Our own.** GitHub's merge queue only exists for repositories owned by an organisation; `MossesX/AmberX-AXF` belongs
to a personal account (`owner.type = User`), so there is no ruleset option to switch on and no `merge_group` event to
listen to. The queue is built into auto-land as plain scripts (zero tokens) and behaves the same way:

| | GitHub merge queue | Ours |
|---|---|---|
| Line of ready PRs | ruleset | Brett's order (Jump to front / drag), then auto-land's landing order, then oldest |
| Test on top of the PRs ahead | `gh-readonly-queue/*` branches | `queue/pr-<n>` = the commit ahead of it + this PR (builds files newer-wins, logs unioned) |
| Merge without retest | fast-forward | GitHub merge with the PR head pinned; the main push then skips every job the queue already ran on that code |
| A red one | removed, the rest rebuilt | kicked out (reason on the PR, in the view, one console alert), the ones behind rebuilt without it |
| Main never breaks | yes | yes: only code CI passed on, as one combined result, reaches main |

If the repo ever moves to an organisation, switch it over: ruleset with merge queue, `merge_group:` in
`android.yml`'s `on:`, and set the push banner's *Merge queue* off (auto-merge then hands PRs to GitHub's queue).

## What changed

| Step | What |
|---|---|
| s1 rules | `push-banner/land/merge-queue-core.mjs` (pure): who is ready and why not, queue order, which part of last round's stack still holds, `decide()` (green head merges in order; a red one is blamed only when every PR ahead passed), kick reason in plain words, ETA, the commands. |
| s2 CI scope | `framework/cli/ci-scope.mjs` + the new first job `scope` in `android.yml`. Path filters per job **and** per app build in the console job (axHub web, AmberX web, Molly, Walkthrough Studio): console-only changes skip Gradle, the AmberX APK and the other app builds; shared framework (`core/react/ui/schemas/libs/assets`), fixtures, CI itself and any unknown path run everything. `android.yml` now also runs on `queue/**` and cancels a superseded queue or PR run. |
| s2 light PR checks | While the queue is on (repo variable `AXF_MERGE_QUEUE=on`, kept in step by the runner), a PR runs only the `light` job: framework validators, tracker, manifests, builds store, theme/controls/toolbars, the console type-check when the console or the framework changed, and the touched plugins' own tests. The full (path-filtered) set runs once, on the PR's queue branch. |
| s2 main skip | A push to main whose code (outside `_claude/`) equals a `queue/pr-*` commit with a green run of the workflow runs nothing again; only the Android publish when Android changed. |
| s3 runner | `push-banner/land/merge-queue.mjs`, called from every `land.mjs run` (the existing 3-minute cron, same lock: no new cron). Auto-land no longer merges main into a branch while the queue is on (that new head is exactly the second CI run), except for a real conflict on a PR the queue isn't testing. |
| s4 console | Push banner 0.7.0: settings `mergeQueue` (on) and `queueDepth` (3, 1–6); auto-merge leaves AmberX-AXF to the queue; REST `GET /queue`, `POST /queue/add`, `/queue/remove`, `/queue/move` (to 0 = Jump to front = Brett's own signed-in click, 403 otherwise); MCP through plugin-commands@1: `push_banner_mergequeue_list`, `_add`, `_remove`, `_move`; CLI `land.mjs queue list|add|remove|move` (= `merge-queue.mjs`). New branch protection leaves GitHub's own "up to date" rule off while the queue is on (it would re-test every stacked PR); an existing strict rule is never loosened. |
| s5 view | Merge queue panel (Settings → Plugins → Push banner, top), the **Merge queue: N** chip in the push banner that opens it inline, Builds menu → *Merge queue*, *Add to Home* (card@1 on `mergequeue-list`). Each row: place, agent avatar, PR title, state (Waiting / Testing / Passed / Kicked out + why), what it's tested with, ETA, run link; Up / Down / drag, Jump to front, Remove from queue; kicked-out PRs with Add back; open PRs not in the queue with why. |

UI Review gate: a PR UI Review holds (e.g. one Brett marked "needs my UI Review") never enters the queue; it shows
under *Not in the queue yet* with the reason and joins by itself once approved.

## CI minutes, before and after (estimate)

Measured on the last 8 `Android framework + console` runs (Nov 4 2026, runner minutes per job): engine sweep 1.7,
Web Dev Console + Python API 5.4, AmberX APK 1.5, Gradle 4.5 → **~13 min per full run**.

| Per PR | Before | After |
|---|---|---|
| On the PR | full run, 13 | light checks, ~3 (npm ci + tsc + validators + its plugin's tests) |
| Main moved on, retest | 13 per pull-in (auto-merge / auto-land pull main in and re-test; typically 1–3 times) | 0 (the queue run covers the PRs ahead) |
| Queue run | – | what the combined diff touches: console-only ≈ 7 (engine + console), shared framework 13 |
| Push to main | full run again, 13 | ~0.3 (scope job only; Android publish only when Android changed) |
| **Total, console-only PR, 2 pull-ins** | **≈ 52 min** | **≈ 10 min** |
| **Total, shared-framework PR, 2 pull-ins** | **≈ 52 min** | **≈ 16 min** |

A kicked-out PR costs one extra queue run for each PR rebuilt behind it (at most `queueDepth − 1`, default 2).

**Live dry run (15:06 UTC, real repo, nothing pushed):** 12 ready PRs lined up. The first 3 were stacked
(#158, #307, #313). #205–#211 wait because they conflict in code with #158 ahead of them, so they get tested once it
merges. The oldest open PRs sit at the front because the order is oldest-first; Brett reorders with drag or
Jump to front.

## Tests

| Check | Before | After |
|---|---|---|
| `land/merge-queue.test.mjs` (new; real git, fake GitHub: stack of 3, green head merges, red kicked + rest rebuilt, status-only main commits keep the stack, control file) | – | 9 passed |
| `framework/spec/check-ci-scope.mjs` (new; path filters, light / full / main-tested, workflow wiring) | – | 9 passed |
| `land/land.test.mjs` | 84 | 91 passed (allow-list covers the queue files; auto-land rounds run with the queue off) |
| `push-banner/test.py` | passed | passed + 7 queue checks (default on, auto-merge leaves the repo to the queue, depth bounds, `/queue` + chip, Jump to front refused without Brett, commands) |
| console `tsc --noEmit`, check-theme, check-controls, check-toolbars, help coverage | green | green (help 100%) |

Both new tests run in CI (engine job).

## Known gaps

- **Git status board tab:** #291 isn't on main yet. The view is one component (`push-banner/web/queue.tsx` →
  `MergeQueueView`); when the board lands it mounts it as its *Merge queue* tab.
- **Bugs board:** no bugs board exists on main, so a kick-out goes to the PR (comment), the view and one console
  alert. When one lands, `queueRound`'s kick branch is the one place to add it.
- **Repo variable:** the runner sets `AXF_MERGE_QUEUE` with the GitHub token. If that token may not write Actions
  variables, the view says so and PRs keep running their full (path-filtered) checks: correct, just not the cheapest.
- **Shared token:** the GitHub token was out of calls during this build (5000/h, shared with the banner and the
  reconciler). The runner caches every finished result per commit, so a quiet round costs one call (the PR list).
