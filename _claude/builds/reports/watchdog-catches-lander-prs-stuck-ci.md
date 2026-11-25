# watchdog-catches-lander-prs-stuck-ci (Pipeline 2.0, Fable, Nov 25 2026)

Brett (Nov 24): refresh-fix part 7 (PR #915) sat in `running-ci` until the build was marked failed and had to be merged
by hand; part 8 (PR #916) did the same. "So what are we gonna do about this problem so it doesn't keep happening? Don't
we have a watchdog for this?"

Three steps, three branches; the lander merges them into one PR.

| Step | Branch | Commit | What |
|---|---|---|---|
| s1 | `claude/watchdog-catches-lander-prs-stuck-ci--s1` | `2f6b85d57` | the stuck-CI lane, the lander's merge call, the cron status |
| s2 | `claude/watchdog-catches-lander-prs-stuck-ci--s2` | `c416c8ef0` | the watch coverage check |
| s3 | `claude/watchdog-catches-lander-prs-stuck-ci--s3` | this one | tests on the three together, this report, the THREADS row |

## What was wrong

- **Nothing watched `running-ci`.** The Stuck statuses watch read landing, fixing and merging only and skipped Pipeline
  2.0 builds. The Pipeline 2.0 watchdog gave `running-ci` 60 minutes and then only nudged the lander. The Build
  sessions watch is off by a saved setting.
- **The lander had stopped on those PRs.** The build was split into one PR per part and used up the lander's attempt
  ceiling on its early parts, so parts 7 and 8 stopped at their first red CI ("needs Brett") and stood there.
- **The merge call.** `merge_method`, the pinned `sha` and the title have to be inside the request body. The call was
  written out inline at its one call site; a call that puts them anywhere else is merged by GitHub with its default
  method, unpinned.
- **`installed: false` on the watchdog cron file.** The cron was installed and running every minute. The status is
  answered from inside the console container, which cannot read `/etc/cron.d`, so it reported the file as missing.

## What changed

**The stuck-CI lane** (`apps/console-web/plugins/build-orchestrator/watchdog/stuck-ci-core.mjs`, `stuck-ci@1`; IO in
`watchdog/stale.mjs`). The Stuck statuses watch now also takes a Pipeline 2.0 build with a lander PR in flight that is
in `running-ci`, failed in `running-ci`, or stopped by the lander in any landing phase, once it has stood longer than
`limit.running-ci`. It reads the PR and the check runs on its head, then:

| What it finds | What it does |
|---|---|
| CI green, the gate's rules passed | merges the PR, pinned to the head the checks were read on; the lander records the merge |
| A check running longer than `ciStuckMin`, or a required check that never reported | starts a fresh CI run on the PR branch, twice per head at most |
| CI red, the lander still has a retry of its own | waits: the lander's ladder (re-run, then a fix session) goes first |
| CI red, the lander stopped | releases the hold into one Fable fix session through the lander's own fix retry; nothing is fixed by hand |
| Red again after that fix, a one-part PR | marks the part for removal (`landing.removal { pr, steps, at, by, why }`) |
| Red again, a PR of several steps | waits: the lander has already reported it |

It never acts on a PR whose state or checks could not be read, a PR it pushed less than its limit ago, a PR closed
without merging, or one merged by hand on red CI. Every catch is its own alert to Brett, whether the action went
through or not.

The removal mark removes nothing by itself: it is the record `drop-failed-part-remove-feature-whose` acts on.

**Settings** (the Stuck statuses watch; console Watchdog panel, REST/MCP/CLI/voice `watchdogs`):

| Key | Default | Meaning |
|---|---|---|
| `limit.running-ci` | 15 min | how long a lander PR may stand in CI, or stopped, before its checks are read |
| `ciStuckMin` | 45 min | a check still running after this long is stuck (a full run takes about 30) |
| `ciFixes` | 1 | fix sessions for a stopped PR before a one-part PR is marked for removal (0 to 3) |
| `intervalMin` | 5 min (was 10) | minutes between passes |

**The lander's merge call** (`deploy/lander/lander-core.mjs` `mergeRequest`, used by `deploy/lander/run.mjs`): the one
place the request is built, with `merge_method`, `sha` and `commit_title` in the body. The watchdog merges through the
same builder. Tests assert the body of the call the lander sends.

**The cron status** (`build-orchestrator/watchdog.mjs`): the host's cron pass records the schedule file as the host
sees it, and status uses that record while the heartbeat is fresh (`source: 'host'`). An old record is not trusted.

**Watch coverage** (`deploy/watchdog/coverage.mjs`, `watch-coverage@1`): for every status a build or step can stand in,
who watches it, after how many minutes and what the catch does, derived from the tables the watchdogs run on. Gaps:
`unwatched`, `slow` (a landing status first looked at after more than 20 minutes), `off` (a watch switched off or a
schedule not installed; live check only). It runs in CI (`coverage.test.mjs`) and on the box as the `coverage` audit
every 30 minutes, one alert per gap with the command that fixes it.

**Contract**: `landing.removal` added to `normLanding` (`framework/core/pipeline-status.mjs`), the pipeline-2 schema
description and `check-pipeline-2.mjs`. Fixtures unchanged. Kotlin twin recorded as a deferred gap in
`framework/spec/PORTING.md`.

## Tests

Run on s1 + s2 merged onto main `e29231ce0` in a scratch worktree (Node 20.20.2). All pass.

| Suite | Result |
|---|---|
| `node --test deploy/watchdog/*.test.mjs` (with `coverage.test.mjs`) | 0 failed |
| `node --test deploy/lander/test/*.test.mjs` | 0 failed |
| `build-orchestrator/test/watchdogs.test.mjs` (the lane's decision table, a pass on fake sources, the cron record) | 35 checks |
| `build-orchestrator/test/watchdogs-store.test.mjs` | 9 checks |
| `build-orchestrator/test/watchdog.test.mjs` | 14 tests |
| `build-orchestrator/test-watchdog.mjs` | 15 checks |
| `build-orchestrator/test/p2-status-contract.test.mjs` | 53/53 |
| `framework/spec/check-pipeline-2.mjs` | 98/98 |
| `framework/spec/check-build-watchdog.mjs` | 401/401 |
| `framework/spec/check-stale-rows.mjs` | 32 checks |
| `framework/cli/tracker.mjs --check` | ok |

s1 and s2 merge without a conflict. With both in, the coverage table shows `running-ci` at 15 minutes, watched by the
Pipeline 2.0 watchdog and the Stuck statuses watch.

Not run: the Python route test (`server/test_watchdogs.py`), the full CI workflow, and the lane against a live stuck
PR. The lane's GitHub calls are tested on fakes only; its first real catch is on the box after the deploy.

## Left open

1. **The Build sessions watch is still off** on the VPS by a saved setting. This build did not turn it on. The coverage
   audit will report it as an `off` gap every 30 minutes until it is on:
   `node apps/console-web/plugins/build-orchestrator/watchdog.mjs set sessions.enabled=on`.
2. **`KNOWN_GAPS` in `coverage.mjs` still lists `build:running-ci:slow`** as closed by this build. With the lane in,
   the gap no longer shows, so the entry is dead and can be deleted. s2 wrote it before s1 landed; left as is here
   because that file belongs to s2.
3. **Schedules after the deploy.** `coverage.mjs check`, run from the scratch worktree, reported the three
   `deploy/watchdog` cron files as differing from the installed ones. That is expected from a checkout that is not
   `/opt/axf` (the lines carry the path) and was not checked from the main checkout. If the audit reports it after
   the deploy: `node deploy/watchdog/cron.mjs install`.
4. **Nothing removes a marked part yet.** `landing.removal` is the mark only; the removal is
   `drop-failed-part-remove-feature-whose`.
5. Kotlin twin of `landing.removal`: deferred (`framework/spec/PORTING.md`).
