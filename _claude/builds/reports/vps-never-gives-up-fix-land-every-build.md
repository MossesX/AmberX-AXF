# VPS never gives up: fix and land every build until all options are exhausted

Build `vps-never-gives-up-fix-land-every-build`, Phase 1 (Opus), branch `claude/vps-never-gives-up-fix-land-every-build`.

## Result

A failing build is now worked on until every rung of its retry ladder has been tried. Only then is it marked Failed,
in the same dispatcher tick. Brett gets an FYI push on every attempt and one push when it fails.

Built on what was already on main from `server-rule-done-means-merged-working` (retry-ladder@1, failure detector,
`retryFixing`, `escalateBuild`). No new contract and no engine change: the work is in the build-orchestrator plugin.

## Steps

- **s1: keep fixing until every option is used up.** The ladder's count caps (`maxAttempts` 5 per kind, `maxTotal` 10
  per build) used to stop it before every rung was tried, for example before every account had been tried.
  `pipeline-core.exhaustPolicy` (used by `retryPolicy()`) now raises them to the retry-ladder@1 ceilings (10 / 30),
  so a build only stops when no rung is left: merge main, fix (targeted, regenerate, redo-step), a fresh session,
  another model at or under the step's pin, then every other account. The ceilings stay as the one safety stop. To turn
  this off, set the `done-means-merged` rule's `untilExhausted: false`.
- **s2: only then back to the orchestrator, which marks it Failed straight away.** The record status is still
  `escalated` (done-means-merged@1, so Retry and the guards are unchanged). Everywhere Brett reads it, it now says
  Failed: the status label ("Failed · every option used up"), the Attempts tab chip and note, the build note, the alert
  ("Build failed, every option used up: …"), the `pipeline.escalated` notify label and the systems check item summary.
  It is set in the same tick the ladder runs out, with no wait and no stop in Pending.
- **s3: FYI on every attempt.** `retryFixing` sends alert `pipeline:attempt:<build>:<n>` each time it starts an
  attempt. The alert says what broke, the strategy it tries now (with account and model) and the rungs left before
  Failed. It is the new notify type `pipeline.attempt` (push, normal priority) in the plugin's `notify.json`.
- **s4:** tests, this report, the THREADS row and the PR.

## How it is reached (API parity)

There is no new screen. The existing surfaces show the new behaviour:

- **Deep link:** `#/build-orchestrator?row=<build>&tab=attempts` (each FYI and the Failed push link there).
- **REST / MCP / CLI:** read the attempts, the ladder and what is next with `orchestrator.mjs attempts <build>` /
  `pipeline.mjs attempts <id>`, and the failed builds with `pipeline.mjs escalated`. Retry with `pipeline.mjs retry <id>
  [strategy]` / `retry-all`. All of these were already exposed as console API routes and MCP plugin commands by
  done-means-merged@1. The FYI push is controlled in Plugins → Notifications (`axf notify-control …`, MCP
  `notify-control_*`, type `pipeline.attempt`).
- **Voice:** AmberX reads the same plugin commands ("retry build X", "which builds failed").
- **Setting:** `untilExhausted` on the `done-means-merged` build rule (Build rules, control@1).

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 66 checks passed. New checks: every kind's
  ladder walks to "every rung of the ladder was tried"; ci-red tries fix, a fresh session, another model and all four
  other accounts; clash tries merge main; the Failed alert title; the attempt FYI alert and its notify type.
- `python apps/console-web/plugins/build-orchestrator/test.py`: 58 passed. `test.mjs`: 35 passed.
- `python apps/console-web/plugins/notify-control/test.py`: 133 passed (the new alert source is registered).
- `node framework/spec/check-done-means-merged.mjs`: 417/417. `check-theme.mjs` and `check-controls.mjs`: pass.

## Notes

- I did not rename the status itself to `failed`, because `failed` is the legacy hand-only status in
  done-means-merged@1. Renaming it would break Retry, the guards and the fixture.
- The Kotlin twin is not affected (no engine change).
