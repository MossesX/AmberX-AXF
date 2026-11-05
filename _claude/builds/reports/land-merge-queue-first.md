# Land the merge queue first (`land-merge-queue-first`, Urgent, Opus; Landin' Lenny)

**Brett said (voice, Nov 4 2026):** "You gotta stop merging these one at a time or they're gonna have to run checks
again. That's what happened last time." … "Land the queue first. Stop everything. Stop merging these things one at a
time so they don't step on each other's toes. Save the compute."

## 1. One-at-a-time merging stopped

| What | Before | After |
|---|---|---|
| Push banner auto-merge (console loop, every 3 min, pulls main into behind PRs = a new CI run each) | on (default) | **off** (`autoMerge: false`) |
| Push banner "open a PR for every branch" (each new PR = a CI run) | on (default) | **off** (`autoPr: false`) |
| Auto-land (`land.mjs run`, merges main into finished builds' branches) | on (default) | **off** (`autoLand: false`, and off by default in code from push banner 0.7.1) |
| `axf-auto-land` cron | already commented out (`paused-by-brett-2026-11-04`) | left paused until #320 deploys; the redeploy turns it back on, and with auto-land off it runs **only the merge queue** |

Breakroom chat: "Auto-merge paused by Brett, landing merge queue first."

## 2. PR #320 (merge queue)

- Updated from main **once** (254 commits behind; merged clean), builds store files pinned to main's copy so GitHub
  doesn't flag the store as conflicting.
- Fixed on the way (all in the same single push, so #320 still costs one CI run):
  - the queue's *light PR checks* type-checked the console without `scripts/sync-data.mjs`, so `src/axf/plan` was
    missing and **every** PR's light run would have failed (14 tsc errors); now it runs sync-data first;
  - `queue.tsx`: two strict-null errors (`w.why` possibly undefined);
  - THREADS carry-on lines needed the push-banner lifecycle marker.
- GitHub's native merge queue: **not available** (`MossesX/AmberX-AXF` is a personal-account repo; merge queues need an
  organisation). The queue is #320's own stacked mode.
- Merged by Brett at 19:51 UTC on the tested head `dd00afb2e` (no second run); the console redeployed once and the
  queue went live (`land.mjs run` every 3 minutes; with auto-land off it only runs the queue).

## 3. Save compute (in #320's push)

| Change | Where |
|---|---|
| Every GitHub GET from auto-land and the queue is cached with its ETag (`gh-cache.json` in the push banner's data folder) and re-sent as a conditional request: an unchanged answer is a 304, which GitHub doesn't count against the 5000/h limit. One client per run shared by auto-land and the queue; each run logs billed vs cached calls (`land.json` → `github`). | `push-banner/land/land.mjs` `makeGitHub` |
| Reads stop when fewer than 300 calls are left on the shared limit (cached answers still served), so the console and the reconciler keep theirs. | same |
| One deploy per stack: while the queue is merging a stack it keeps `push-banner/queue-merging` fresh; the console's 5-minute updater skips while it is (stale after 15 min). | `merge-queue.mjs`, `deploy/install-console.sh` |
| Auto-land is off by default; the rule says only the queue merges and nothing updates a PR from main outside it. | `land-core.mjs`, `land.mjs`, server `config()`, `_claude/shared/rules/RULES.md`, `_claude/rules/RULES.md` |

### What was really burning the GitHub limit

With auto-merge, auto-PR and auto-land all off, the shared 5000/h limit still ran dry within the hour (17:06 → 0 at
18:06, then 0 again by 19:02). The culprit: the push banner's branch list (`GET /api/plugins/push-banner/branches`,
cached 120 s, refreshed whenever a console tab shows the banner) asked GitHub for a compare, the head commit and the
check runs of **every** branch (up to 150 in AmberX-AXF) and the full PR of every open PR, on every refresh: about
300–450 calls a refresh, ~5000 an hour from one open tab. Fixed in the batch (`push-banner/server/__init__.py`):

- a branch's answer is kept until its own commit changes;
- main moving only by builds-live status commits under `_claude/` (several a minute) costs **one** compare per repo,
  and every kept branch's `behind` moves on by those commits; main moving in code recomputes everything (rare now);
- finished check runs are kept 15 minutes for the listing (merging always reads GitHub fresh);
- a PR's mergeable state is kept per head + base.

A quiet refresh now costs ~4 calls per repo instead of ~400. Tests: push-banner 178 passed (4 new for the cache).

## 4. The waiting batch

Built as **one** branch, `claude/land-batch-1`, on top of #320: each PR merged with `Merge pull request #N from …` so
merging the batch marks every one of them merged. It goes through the queue as **one entry**: one queue run on
main + #320 + all of them, instead of one run per PR (the queue's depth-3 stack would have been 8 runs).

| PR | Build | In the batch | Why |
|---|---|---|---|
| #327 | tab-group-assets | yes | |
| #325 | urgent-approval-popup-crash | yes | |
| #319 | fable-no-approval | yes | |
| #330 | urgent-console-perf | yes | |
| #328 | molly-multi-instance-tabs | held | UI Review r-20261104-180b51e6 waiting for Brett |
| #326 | jump-menu-asset | held | UI Review r-20261104-2135a0d7 waiting |
| #305 | terminal-no-focus | held | UI Review r-20261104-22549d23 waiting |
| #323 | app-voice-commands | held | UI Review r-20261104-1b7bca5f / a4e5d893 waiting |
| #318 | profile-lists-home-card | held back (Brett) | red |
| #322 | apps-control-surface | held back (Brett) | UI Review |
| #299 #301 #302 | WIP | held back (Brett) | WIP |
| axHub pass-dropdowns | (axHub repo) | separate | no queue in axHub |

Batch fixes: change-log JSON conflicts (newer copy kept), RULES.md unioned, help for the 15 new controls
(ChromeContext / TabGroup / plugin loader / Follow Amber; coverage back to 100%), shared help assets re-baked into the
four apps. Local checks on the batch: the engine sweep (43 commands), console `tsc --noEmit`, every touched plugin's
Python and JS tests green; the only reds (`session-checkin`, `plan-studio`, `systems-check`) are red on main too in
this environment (headless env / Node 20 here, Node 22 in CI).

## Result

### What landed

| PR | How | When (UTC) |
|---|---|---|
| #320 merge queue | merged on its one green run (by Brett) | 19:51 |
| #339 batch = **#327 tab-group-assets, #325 urgent-approval-popup-crash, #319 fable-no-approval** + push banner API cache + light-check switch + help + report | one queue entry, merged by the queue with no retest; GitHub marked #327 / #325 / #319 merged with it | 22:15 |
| #330 urgent-console-perf | got a new commit from its own session while waiting, rejoined the queue and was merged by the queue alone (with #332 in the same round) | 20:36 |

Kicked out once: **#339** (20:24), its queue run failed on two things the PR checks never ran:
1. `check-agent-card`: #327 carried an `agent-card.json` regenerated by a `gen-fixtures.mts` that never wrote the
   avatar section (it had been hand-added to the fixture on main). Fixed in the generator; the fixture is now
   identical in content to main's.
2. Plugin lifecycle: #327's new ratchet file `framework/spec/chrome-baseline.json` names plugin files by path, which
   the scanner called stale references (10 plugins). Ratchet baselines are now skipped like the other generated records.

Then the PR's light checks went red twice on things that weren't the batch's: a flaky `ai-assistant` test (passed on
the rerun, 6/6 locally) and `build-orchestrator`'s repo-store check, which failed on **another session's live build**
(`ui-review-alarm`, steps without estimates yet). That check now fails only on steps over 30 minutes and flags missing
estimates, the way `pending.mjs --check-steps` does, so a build being written can't turn every PR red.

Still waiting on Brett's UI Review, so not landed: #305, #323, #326, #328. Held back as he said: #318, #322,
#299/#301/#302. axHub pass-dropdowns: separate repo, not touched by this build.

### Found on the way: main went red

After the queue merged #332 + #330, both main runs failed in Gradle: CI scope (from #320) skipped the AmberX APK job,
and the app bundle step failed on the missing APK. Fix in PR **#348** (`app-bundle.mjs collect --skip`, passed when
the AmberX job didn't run), going through the queue. Until it lands, a main push that skips AmberX shows Gradle red.

### CI runs used (Android framework + console workflow)

| For | Runs |
|---|---|
| #320 | 1 full PR run (all green) + the main push after Brett's merge (not queue-tested, so a full path-filtered run) |
| #339 | PR light checks: 3 runs + 1 rerun of the failed light job (~2–3 min each); queue runs: 2 (one kicked, one green); main push: CI scope + Gradle only (engine and console skipped: the queue had tested that code) |
| Cancelled to save minutes | `queue/pr-319` (it rides in #339), #330's own PR run |

Before (auto-merge / auto-land one at a time): each of these PRs would have had a full run on its PR, another full run
each time main was pulled in (typically 1–3 times), and a full run on main: about 9 PRs × 3–4 full runs ≈ 30 full runs.
Here: 2 full queue runs and 1 full PR run for the lot, plus light runs.

### GitHub API calls

| | Before | After |
|---|---|---|
| Auto-land + queue round (`land.mjs run`) | ~800 a run (the brief); 69 on the first cold round | 5–7 billed + ~20 free (304) a round |
| Push banner branch list | ~300–450 a refresh, every 2 min: the shared 5000/h ran out at 18:06 and again by 19:02 | ~4 a repo a quiet refresh (deployed with #339) |
| Shared token, whole VPS | 5000 used within the hour | 105 used in the first 11 minutes of the 22:06 window (≈ 570/h) before the banner fix deployed |

### Left OFF

Auto-land, auto-merge and auto-PR are off in the push banner config; auto-land is off by default in code (0.7.1); the
rules (`_claude/shared/rules/RULES.md`, `_claude/rules/RULES.md`) say only the merge queue merges and nothing updates a
PR from main outside it. The `axf-auto-land` cron is back on and runs only the queue. PRs that aren't part of this job
were taken out of the queue pinned to their current head (`merge-queue-control.json`): a new commit on one puts it back
in line by itself, and Brett can add any of them from the Merge queue view.

### Known gaps

- The `AXF_MERGE_QUEUE` repo variable can't be set with the token the runner has (403; the GitHub App broker falls back
  to the old PAT). The committed `.github/merge-queue.json` does the job; the view still shows the variable error.
- `build-orchestrator`'s and similar repo-store checks read live data in CI; any other test like that can still go red
  on another session's write.
