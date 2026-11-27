# Server rule: done means merged and working, never stop on failure

Build `server-rule-done-means-merged-working`. Phase 1 (Fable): contract, statuses, records, migration, retry
ladder (s1–s3). Phase 2 (Opus): enforcement, detector, auto-retry, lander, verify, escalation, UI, API, tests (s4–s16).

Brett, Nov 17 2026 (verbatim):
> We asked you to build it. You should do whatever you have to do to build it, period. Why should we say build it and
> then it fails and you don't say anything and we find out days later?

## What changed for Brett

Before: a build was `built` when its last step was ticked and `complete` when something set `mergedAt`. A crash sent it
back to the Queue a few times, then to Pending. Red CI on main after a merge went unnoticed. Nobody told him.

After:

- **Done means merged and working.** `landed` = PR merged + CI green on the merge commit. `complete` = landed + the
  feature verify passed. The builds store refuses anything else and notes the refusal on the build.
- **Never stop on a failure.** Every tick classifies crash, red CI, clash, push failure, stall and fell-to-Pending,
  records it (`fixing`) and relaunches on the retry ladder, a different strategy each time.
- **Escalate loudly, once.** When the ladder runs out: one red systems check item ("Builds that need you") with what
  broke, every try and since when, a Retry button, and one phone push.

## Contract (done-means-merged@1)

Spec: `framework/spec/DONE-MEANS-MERGED.md`. Engines: `framework/core/build-pipeline.mjs` (records, `guardStatus`,
migration) and `framework/core/retry-ladder.mjs` (pure ladder). Fixture: `framework/spec/fixtures/done-means-merged.json`.
Check: `node framework/spec/check-done-means-merged.mjs` (417 checks, in CI).

Status ladder: `pending → queued → running (building) → landing → landed → complete`, with `fixing` for any failure
and `escalated` when the ladder runs out. `built` is legacy (= landed, same proof).

## The ladder

| Failure | Rungs (each used once per failure kind) |
| --- | --- |
| crash | retry → fresh session → another account → another model → escalate |
| CI red | fix: targeted → fix: regenerate → fresh session → another model → another account → escalate |
| clash | merge main → fix: targeted → fresh session → another model → escalate |
| push failed | retry → fresh session → another account → escalate |
| stalled | fresh session → another account → another model → escalate |
| fell to Pending | retry → fresh session → another model → another account → escalate |

Limits: 5 failures per kind, 10 in total, a backoff between tries (2, 4, 8 … max 30 min), never above the step's
pinned model. PR-side failures (clash, red CI) go to the auto-lander first. The build's ladder takes over once one
of the lander's tries failed or timed out.

## Where each piece lives

| Step | What | Where |
| --- | --- | --- |
| s4 | check: guards, migration, ladder never repeats, escalation only after N different attempts; in CI | `framework/spec/check-done-means-merged.mjs`, `.github/workflows/android.yml` |
| s5 | store guard on every write, refusal noted; `set-status`; evidence on `link` | `framework/plan/builds-store-core.mjs` (`guardedStatus`, `enforceDoneGuard`), `framework/cli/builds-store.mjs`, `framework/cli/builds-live.mjs` |
| s6 | build rule `done-means-merged` in every build brief | build-rules@1 live store (rev 5), `framework/cli/build-rules-migrate.mjs`, seed, `framework/spec/BUILD-RULES.md` |
| s7 | failure detector in the tick | `pipeline-core.mjs` `classifyFailure` / `recordFailure`, `pipeline.mjs` `detectFailures` |
| s8 | auto-retry through `deploy/claude-headless.sh` with a Retry block in the brief | `pipeline.mjs` `retryFixing`, `pipeline-core.mjs` `retryAddendum` / `attemptOf` |
| s9 | the auto-lander writes into the same attempts log, sets landing, records CI on the merge commit | `push-banner/land/land-core.mjs` `shareOps` / `mergeFollow`, `land.mjs` `shareWithBuilds`, `builds-store.mjs attempt` / `fail` |
| s10 | feature verify after merge | `build-orchestrator/verify.mjs`, started by the tick (`kickVerify`) |
| s11 | escalation: health@1 item + one push | `pipeline.mjs` `escalateBuild`, `server/__init__.py` `builds-escalated`, `notify.json` `pipeline.escalated` |
| s12 | status chip + Attempts tab | `build-orchestrator/web/attempts.tsx`, `pipeline.tsx`, `ui.tsx` |
| s13 | API parity | see below |
| s14 | tests | `test.py` (routes, probe), `pipeline.test.mjs` (tick simulation) |
| s15 | UI Review: 3 options | item `r-20261117-yj8u501`, assets `build-orchestrator/assets/badge/build-attempts-status-*.json` |

## API reach, per feature

| Feature | Deep link | REST | MCP | CLI | Voice / console action |
| --- | --- | --- | --- | --- | --- |
| Status chip | `row:<build>` | `GET /api/plugins/build-orchestrator/pipeline` (row `status`, `failure`, `landed`, `escalation`) | `pipeline-status` | `pipeline.mjs status`, `orchestrator.mjs attempts <build>` | `build-orchestrator.open:<build>` |
| Attempts | `row:<build>/tab:attempts`, `tab:build-orchestrator.build=attempts` | `GET …/attempts/<build>` | `attempts` | `orchestrator.mjs attempts <build>`, `pipeline.mjs attempts <build>` | `build-orchestrator.attempts:<build>` ("what's wrong with …", "why did … stop") |
| Retry | `button:retry-<build>` | `POST …/retry/<build>` `{strategy?, why?}` | `retry` | `orchestrator.mjs retry <build> [strategy]`, `pipeline.mjs retry \| retry-all` | `build-orchestrator.retry:<build>[\|strategy]` ("retry … in a fresh session") |
| Escalation item | `view:systems-check` (item `builds-escalated`) | systems check `GET health`, `POST health/autofix/builds-escalated` | systems check tools | `pipeline.mjs escalated` | systems check actions |
| Store guard | — | every store write | every store write | `builds-store.mjs set-status <build> <status>` | — |
| Evidence | — | — | — | `builds-live.mjs link <build> --sha --ci --verified` | — |
| Verify | — | — | — | `verify.mjs list \| plan <build> \| run [<build>]` | — |
| Attempts from elsewhere | — | — | — | `builds-store.mjs attempt <build> --attempt <json> \| --close ok`, `fail <build> --kind …` | — |

## Checks run (final)

`check-done-means-merged` 417/417 · `check-builds-store` 40 · `check-build-steps` 44 · `check-builds-live` 69 (one
run out of nine had 2 failures I could not reproduce; eight clean runs since) · `check-build-pipeline` 154 ·
`check-build-rules` 27 · `check-feature-ledger` 66 · `pipeline.test.mjs` 62 · `test.mjs` 35 · `test.py` 58 ·
`land.test.mjs` 113 · gate 21 · notify-control 133 · theme, controls, toolbars, chrome-assets, console-control,
plugin-commands all green · console `tsc --noEmit` clean.

## Known gaps

- A `ci-red` on main after a merge relaunches on the build's own branch, with the failure (merge commit) in the brief.
  The spec's fix branch off main is not built yet.
- The retry policy is always the defaults: build-rule@1 has no `settings` field yet.
- Kotlin twin of the ladder / guard: deferred (PORTING.md; Android on hold).
- The UI choice (pill + grid is built) waits for Brett in UI Review.
