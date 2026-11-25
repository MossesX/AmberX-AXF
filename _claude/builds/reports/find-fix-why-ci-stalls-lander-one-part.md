# Find and fix why CI stalls on lander one-part PRs

Build: `find-fix-why-ci-stalls-lander-one-part` · step s1 (Fable) · 2026-11-25 · all times UTC

## Result

- **CI never stalled.** On PRs 915, 916, 917 (and 918) the full CI run started within 10 seconds of the push and
  finished **red** in 26 to 33 minutes. No dispatch was needed, none was sent, no required check name was missing,
  nothing timed out.
- **Why it was red:** part 7 (#915, commit `02d901d1b`) added a "Hide this notice" button with no help entry. The
  help-coverage ratchet (`node framework/cli/help-coverage.mjs --check`: console-web 1758/1759) fails on it. That one
  check fails two jobs: `Build engine sweep (Node)` directly and `Web Dev Console (React/TS) + Python API` through
  `framework/spec/check-help.mts`.
- **Why every later part was red too:** #915 was merged by hand while red (21:12:50). Main has been red since
  (`7effff076`, three red push runs in a row). The lander pulls main into each new part, so parts 8, 9 and 10 inherited
  the same failure.
- **Why they did not merge by themselves:** the lander was right not to merge a red PR. But it also did not try to fix
  it: the attempt cap (5) is counted over the whole landing run, and this build was split into 11 PRs. Attempts 1 to 4
  were used up by parts 1 to 7, so the first red CI on part 8 was "attempt 5 of 5: stopped, needs Brett". Parts 8, 9
  and 10 each stopped on their first failure, with no re-run and no fix session, and waited 1 h 43 to 1 h 54 for a hand
  merge.
- **"unstable" on GitHub** means "checks failed, none of them required". Main has no branch protection and no
  rulesets, so GitHub lets anyone merge a red PR.
- **Fixed in this step:** the missing help entry (`apps/console-web/src/assets/help/console.json`, commit `7860bcac6`).
  The failing check passes on current main and on all four recorded heads with it. This file is outside the step's
  listed files: it is the root cause, six lines, and without it this build's own PR goes red too.
- **Not fixed in this step (step s2 owns `deploy/lander`):** the attempt cap per landing run. See "Chosen fix".
- **Still open:** main stays red until this build lands. PR #919 (part 11) is stopped on a code conflict with main
  (attempt 9), it needs `node deploy/lander/run.mjs retry fix-refreshing-console-jumps-back`.

## 1. Evidence

Read-only through the token broker (`framework/cli/github-token.mjs token`). The broker has no GitHub App set up and
falls back to the old personal token, so two endpoints answered 403: classic branch protection and repo variables.
Both are covered another way below.

### PRs

| PR | Part | Branch | Opened | Final head | Earlier heads | Merged | How |
|---|---|---|---|---|---|---|---|
| 915 | 7 | `lander/fix-refreshing-console-jumps-back-7` | 11-24 20:18:24 | `25ec59d8d` (fix session: main merged in) | `02d901d1b` | 11-24 21:12:50, `7effff076` | by hand, squash, account MossesX |
| 916 | 8 | `…-8` | 11-24 21:13:26 | `c644a8766` (lander: main merged in) | `ac963b29a` | 11-24 23:33:59, `78f513661` | by hand, squash, account MossesX |
| 917 | 9 | `…-9` | 11-24 23:48:11 | `230824dee` (lander: main merged in) | `031d06781` | 11-25 02:01:33, `54f8fbbea` | by hand, squash, account MossesX |
| 918 | 10 | `…-10` | 11-25 02:02:31 | `e88545a3c` (lander: main merged in) | none | 11-25 04:21:34, `e29231ce0` | by hand, squash, account MossesX |

None was merged by the lander: its merges are merge commits titled "Merge pull request #N … (lander: …)", and its log
says "merged by hand" for each. The lander's token is the same account, so the API cannot say who pressed the button.

### android.yml workflow runs

| PR | Run | Event | Head sha | Created | Finished | Conclusion |
|---|---|---|---|---|---|---|
| 915 | 45481359917 | pull_request | `25ec59d8d` | 20:29:36 | 20:55:31 | failure |
| 915 | none | | `02d901d1b` | | | no run: the PR conflicted with main, GitHub had no merge ref |
| 916 | 45488894644 | pull_request | `ac963b29a` | 21:13:30 | 21:13:57 | cancelled (superseded by the next push, as designed) |
| 916 | 45488962068 | pull_request | `c644a8766` | 21:13:53 | 21:39:21 | failure |
| 917 | 45512997789 | pull_request | `031d06781` | 23:48:15 | 23:48:37 | cancelled (superseded) |
| 917 | 45513038585 | pull_request | `230824dee` | 23:48:33 | 00:18:40 | failure |
| 918 | 45530188567 | pull_request | `e88545a3c` | 02:03:23 | 02:36:13 | failure |

No `workflow_dispatch` run exists on any of these heads or branches. Every run started at its created time (no queue
wait) and was attempt 1 (nothing was re-run).

### Check runs on the final heads

| Check | 915 `25ec59d8d` | 916 `c644a8766` | 917 `230824dee` | 918 `e88545a3c` |
|---|---|---|---|---|
| CI scope (what changed) | success 20:29:39 → 20:38:52 | success 21:13:59 → 21:21:45 | success 23:48:39 → 00:01:21 | success 02:03:25 → 02:13:27 |
| Build engine sweep (Node) | **failure** 20:38:55 → 20:55:30 | **failure** 21:21:47 → 21:39:21 | **failure** 00:01:24 → 00:18:39 | **failure** 02:13:30 → 02:36:12 |
| Web Dev Console (React/TS) + Python API | **failure** 20:38:55 → 20:43:33 | **failure** 21:21:47 → 21:26:33 | **failure** 00:01:24 → 00:05:32 | skipped (scope) |
| Gradle — framework modules, kernel tests, console APK | success 20:38:55 → 20:43:54 | success 21:21:47 → 21:27:25 | skipped (scope) | skipped (scope) |
| Light PR checks (…) | skipped | skipped | skipped | skipped |
| CodeRabbit (not GitHub Actions) | skipped | skipped | skipped | skipped |

- Failing step, engine job, all four: `Run node framework/cli/help-coverage.mjs --check`.
- Failing step, console job (915, 916, 917): "Alerts + MCP client + axf_server …", inside it `check-help.mts` runs the
  same `help-coverage.mjs --check`.
- The log line, same on every head: `✗ console-web: help coverage fell to 99.9% (ratchet 100%): add help for the new
  controls`.
- Commit statuses: none on any head (`total_count: 0`). CI reports through check runs only.
- Superseded heads `ac963b29a` and `031d06781`: all five checks `cancelled`. `02d901d1b`: no check runs.

### Main

- Required checks: **none.** `GET /branches/main` → `protected: false`, `required_status_checks.enforcement_level:
  off`, no contexts. `GET /rulesets` and `GET /rules/branches/main` → empty. The ruleset that
  `deploy/branch-protection.test.mjs` describes is not applied.
- Main's CI: green on `9b1dc61a8` (after #914, 20:51). Red on `7effff076` (#915), `78f513661` (#916), `54f8fbbea`
  (#917), same two jobs. The run on `e29231ce0` (#918) was still going at 04:30.
- Reproduced on this worktree (main at `e29231ce0`): the check fails and names the control:
  `hide-this-notice  button  Hide this notice  apps/console-web/src/pluginLoader.tsx:604`.
- `git log -S"Hide this notice"`: added by `7effff076` (#915), from step commit `02d901d1b`.

## 2. The lander side

### The running-ci path (`deploy/lander/run.mjs`, `lander-core.mjs`)

1. `checksOf(head)`: every check run on the branch head, all pages.
2. `lightOnly(runs)`: true only when a "Light PR checks" job ran and nothing else but the scope job did. Then the full
   run is dispatched once per head (marker `landing.fullKick: { head, at }` on the build in the builds store) and the
   state stays `running-ci` until `ciTimedOut` (120 min from the status change or the last main pull) → `failed`,
   kind `ci-timeout`.
3. `ciOf(runs, { required })`, newest run per name, GitHub Actions only:
   - `none` (nothing ran): after 10 min one dispatch per head (marker `landing.ciKick`), stays `running-ci`.
   - `running`: stays `running-ci`; past 120 min → `failed`, `ci-timeout`.
   - `failure` (any check that ran did not end `success`): → `failed`, kind `ci-red`.
   - `missing` (nothing red or running, a required name has no check run; a skipped one counts as reported): after
     10 min one dispatch per head (`fullKick`); past 120 min → `failed`, `ci-timeout`.
   - `success`: build rules once per head, then `merging-main`.
4. `failure()` in `lander-core.mjs` picks the retry for `ci-red`: re-run (once per head), then a fix session (two per
   PR), then stop. Above that sits one more rule: `attempt >= maxAttempts` (5) → stop, whatever the retry would have
   been. `attempt` is `landing.attempt`, the failures of the whole landing run, and it is not reset when a PR merges.

The required list (`deploy/lander/config.json` `requiredChecks`) holds four names. All four are job names in
`android.yml`, letter for letter.

### What the lander saw and did (`/var/log/axf-lander.log`, builds store status log)

| Time | Part | What it saw | What it did |
|---|---|---|---|
| 11-24 16:47 | all | steps s7 and s8 conflict | attempt 1, split into 11 PRs |
| 18:33 | 3 | merge refused (conflict) | attempt 2, pull main |
| 20:17:49 | 7 | #915 opened, main conflicts with it | attempt 3, fix session at 20:26 |
| 20:30:19 | 7 | fix session pushed `25ec59d8d` | `running-ci` |
| 20:31 → 20:54 | 7 | "CI is running" (24 ticks) | waited |
| 20:56:01 | 7 | CI red (engine, console) | attempt 4, re-run due 21:12:01 (16 min backoff) |
| 21:12:52 | 7 → 8 | #915 merged by hand, 49 s after the re-run was due | recorded, opened #916, pulled main in |
| 21:14 → 21:38 | 8 | "CI is running" (24 ticks) | waited |
| 21:39:49 | 8 | CI red (console, engine) | **attempt 5 of 5: stopped, needs Brett.** No re-run, no fix session |
| 21:39 → 23:33 | 8 | nothing | **1 h 54 idle** |
| 23:33:47 | 8 → 9 | #916 merged by hand | recorded; opening #917 failed ("fetch failed"): attempt 6, stopped again |
| 23:47:47 | 9 | retry from the console | went on (the attempt count was not reset) |
| 23:49 → 00:17 | 9 | "CI is running" (29 ticks) | waited |
| 11-25 00:18:50 | 9 | CI red (console, engine) | **attempt 7 of 5: stopped** |
| 00:18 → 02:01 | 9 | nothing | **1 h 43 idle** |
| 02:01:28 | 9 → 10 | #917 merged by hand | recorded, opened #918 |
| 02:36:24 | 10 | CI red (engine) | **attempt 8 of 5: stopped** |
| 02:36 → 04:21 | 10 | nothing | **1 h 45 idle** |
| 04:23:21 | 11 | #918 merged by hand; #919 conflicts with main | attempt 9, stopped |

Where it stopped moving: the tick that read the red check runs. From there the build is `failed` with
`failure.retry: hold`, and a held build is never retried. The log has no dispatch line in the whole window, and no
`fullKick` or `ciKick` was written: the dispatch branch was never entered.

Part 7 waited 54 minutes in all and was inside the retry ladder the whole time. It is the part that brought the red
check in.

## 3. The workflow side (`.github/workflows/android.yml`)

- Triggers: `push` on `main` and `queue/**`; `pull_request` with no branch or path filter; `workflow_dispatch`.
  A push to a `lander/*` branch starts nothing by itself. The PR on it does.
- Does a push by the lander's token start a run? Yes. Each `pull_request` run was created 7 to 9 seconds after the
  lander's push (916: push 21:13:44, run 21:13:53). The token is a personal token; only the Actions' own
  `GITHUB_TOKEN` suppresses runs.
- Job conditions: every job hangs on the `scope` job's outputs (`framework/cli/ci-scope.mjs`). `pull_request` is light
  only while the repo variable `AXF_MERGE_QUEUE` is on. The scope logs say `ci-scope: full` on all four runs, and the
  "Light PR checks" job was skipped: the variable is not on. Path filters then skip jobs the change does not need
  (917: Gradle; 918: Gradle and console). A skipped job still reports a check run under its name.
- Concurrency: group `ci-${{ github.ref }}`, cancel-in-progress for `pull_request` and `queue/`. A PR run's ref is
  `refs/pull/N/merge`, a dispatched run's is `refs/heads/lander/…`: different groups, so a PR run cannot cancel a
  dispatched one, and a dispatched run is never cancelled in progress. The only cancelled runs are the two on
  superseded heads, which is the intent.
- Names and shas: a `pull_request` run reports on the PR head sha (table above). A `workflow_dispatch` run reports on
  the branch head sha: run 45455204174 on `lander/fix-refreshing-console-jumps-back-3` at `b3d8828a0` reported scope,
  engine and console as success, Gradle and light as skipped, on that sha.
- Compared with the lander's list: all four required names are reported by both kinds of run. Main requires nothing.

## 4. Root cause, and what was ruled out

**Root cause (proven):** a real red check. `02d901d1b` (part 7) added a control without help; the help-coverage
ratchet fails; #915 was merged red by hand; main turned red; every later lander PR carries main and fails the same
check. The lander then gave up at once on each part because its attempt cap had been spent earlier in the same landing
run.

| Hypothesis | Verdict | Evidence |
|---|---|---|
| The full `workflow_dispatch` run never starts on `lander/*` | wrong | no dispatch was needed or sent: the `pull_request` run was already full |
| The run starts but never reports | wrong | all four runs completed in 26 to 33 min with check runs on the head sha |
| A required check name does not match | wrong | `ciOf` on the recorded check runs: `missing=[]` on all four heads |
| Only light checks ran (`lightOnly`) | wrong | `lightOnly=false`; the light job was skipped; scope mode `full` |
| Concurrency cancels the run | wrong | only the two superseded heads were cancelled |
| `ciTimedOut` never fires / fires wrong | not involved | nothing ran longer than 33 min against a 120 min limit |
| Branch protection blocks the merge | wrong | main has no protection and no rulesets |
| The lander's token does not trigger CI | wrong | runs created seconds after each lander push |

### Chosen fix

1. **The missing help entry** (done here, `7860bcac6`): one written entry for `hide-this-notice` in
   `apps/console-web/src/assets/help/console.json`. Main goes green again once this build lands.
2. **Attempt cap per PR, not per landing run** (`deploy/lander`, step s2): a build split into N PRs must give each PR
   its own ladder (re-run, two fix sessions), so the first red CI on part 8 starts a fix session, not a stop. A fix
   session with this log would have added the help entry in minutes. Reset the count when a PR merges, by the lander
   or by hand, and when a retry comes from the console (the 23:47 retry kept the count at 6).
3. Not chosen: loosening the required list, merging on "unstable", or re-dispatching CI. None of them is the fault,
   and each would have merged a red PR.

Side findings, not fixed here:

- The `scope` job checks out the full history (`fetch-depth: 0`): 7.5 to 12.5 minutes per run (915: the checkout step
  alone took 9 min 02 s) before any other job starts. A third of every CI run.
- After a red PR is merged by hand the lander records it and opens the next part on top of a red main. It only looks at
  that merge's CI again at the very end (`landed`). Naming "main is red on the same check" in the failure would have
  made the cause visible at part 8.
- Main has no required checks. The planned ruleset would have refused the red hand merge of #915.

## 5. The fix on real data

The lander's decision code, read-only (no dispatch, no merge), on the recorded check runs:

| Head | `lightOnly` | `ciOf` | Lander state |
|---|---|---|---|
| 915 `25ec59d8d` | false | failure: engine, console | failed, `ci-red` |
| 916 `c644a8766` | false | failure: console, engine | failed, `ci-red` |
| 917 `230824dee` | false | failure: console, engine | failed, `ci-red` |
| 918 `e88545a3c` | false | failure: engine | failed, `ci-red` |
| dispatched run, `b3d8828a0` (lander branch) | false | success, `missing=[]` | green: every required name reported |
| #919 `8057ff647` (open, part 11) | false | success (run from 11-24 14:17, before main went red) | held on the conflict with main, not on CI |
| #920 `18ca4064f` (open, this build) | false | none | head is a `[skip ci]` commit: no run yet, by design |

The decision code is correct on every head. It is not what has to change; s2's regression test should expect
`ci-red` for 915 to 918, not green.

The failing check, replayed on each recorded head in a temporary worktree:

| Head | Before | After (with `7860bcac6`) |
|---|---|---|
| 915 `25ec59d8d` | ✗ coverage fell to 99.9% | ✓ help coverage at or above the ratchet |
| 916 `c644a8766` | ✗ | ✓ |
| 917 `230824dee` | ✗ | ✓ |
| 918 `e88545a3c` | ✗ | ✓ |
| main `e29231ce0` | ✗ 1758/1759 | ✓ 1759/1759 |

`help-coverage --check` was the only failing step in both red jobs on all four heads, so with it passing those runs
have no red step left.

Only the next real landing can confirm:

- This build's PR #920 goes green and the lander merges it by itself. Check:
  `node deploy/lander/run.mjs show find-fix-why-ci-stalls-lander-one-part` shows `running-ci → merging-main → landed`
  with no "merged by hand" line.
- Main's `android.yml` push run on that merge commit ends `success` (the first green one since `9b1dc61a8`).
- The per-PR attempt cap (s2) needs a split build whose later part goes red: it must show "fix session 1 of 2
  started", not "stopped (attempt N of 5)".

## 6. Tests

| Check | Result |
|---|---|
| `node --test deploy/lander/test/*.test.mjs` | 95 pass, 0 fail |
| `node framework/spec/check-landing-line.mjs` | 32 checks passed |
| `node framework/spec/check-gate-rules.mjs` | 38 checks passed |
| `node framework/spec/check-json-data-writes.mjs` | pass, none new |
| `node framework/cli/help-coverage.mjs --check` | pass (was failing on main) |
| `npx tsx framework/spec/check-help.mts` | 283 checks passed |

Nothing was merged, updated or re-run by hand. No dispatch was sent.
