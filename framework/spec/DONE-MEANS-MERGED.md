# DONE-MEANS-MERGED — done-means-merged@1, a build is done when it is merged and working

Status: contract since Nov 17 2026 (build `server-rule-done-means-merged-working`, Fable phase). Brett, Nov 17 2026:
"We asked you to build it. You should do whatever you have to do to build it, period. Why should we say build it and
then it fails and you don't say anything and we find out days later?"

Reference engine: `framework/core/build-pipeline.mjs` (the builds@1 fields, status guards, migration: `normAttempt`,
`normLanded`, `guardStatus`, `migrateDone`) and `framework/core/retry-ladder.mjs` (pure: `nextStrategy`, `escalationOf`,
`ladderFor`, `walk`; registry `framework/schemas/retry-ladder.json`). Fixture: `framework/spec/fixtures/done-means-merged.json`
(`spec/check-done-means-merged.mjs`: records, guard, migration, ladder, one full walk per kind). Server rule:
`done-means-merged` in `build-rules@1` (BUILD-RULES.md; its brief block goes into every build brief). Kotlin twin
deferred (PORTING.md). Reuses the auto-lander (`auto-lander@1`, AUTO-LANDER.md, build `server-auto-lander-fixes-lands`):
its attempt record, its escalation record and its policy shape; this contract is the build-wide ladder the lander's
per-PR ladder sits inside.

## What it is

Until now a build was `built` the moment its last step was ticked and `complete` when something set `mergedAt`. Neither
word proved anything: a build could be "built" with a PR that never merged, "complete" with CI red on main, or quietly
back in Pending after a crash, and nobody heard. This contract changes what the words are allowed to mean, and makes
every failure on the way a thing the server works on and records, never a thing that stops the build.

Three rules, enforced on the VPS for every build and every session:

1. **Done means merged and working.** A build is `landed` only once its PR is merged to main and CI is green on the
   merge commit. It is `complete` only once, on top of that, its feature verify passed. Nothing else may set those
   words (the store refuses; `guardStatus`).
2. **Never stop on a failure.** A crash, red CI, a clash, a push that failed, a stalled session, a build that fell back
   to Pending: each is classified, recorded as an attempt, and answered by the retry ladder (same approach again, then a
   different fix strategy, then a fresh session, then another model or account). The build's status says what is
   happening (`fixing`, `landing`), never a dead end.
3. **Escalate loudly, once.** Only when the ladder runs out does the build go `escalated`: one systems check banner item
   (health@1) with what broke, what was tried and since when, with a Retry / Fix button, and one phone push through
   `axf.notify@1`. Never a chat line, a log line or a note alone.

## The status ladder (builds@1 `status`)

```
pending → queued → running (Building) ──every step done──▶ landing ──merged + CI green──▶ landed ──verify ok──▶ complete
                      │   ▲                                   │   ▲                          │
                      │   └── ok ──┐                          │   └── ok (new head) ──┐      └── verify failed ──┐
                      ▼           │                           ▼                       │                          ▼
                    fixing ◀──────┘◀── a failure ────────── fixing ◀──────────────────┘◀──────────────────── fixing
                      │
                      └── the ladder ran out ──▶ escalated  (banner + push; a hand retries or resets)
```

| Status | Means | Who writes it | Tab |
| --- | --- | --- | --- |
| `pending` | filed, Brett has not queued it | orchestrator, Brett | Pending |
| `queued` | in the Queue, waiting for a slot | Brett, the dispatcher (phase ends) | Queue |
| `running` (**building**) | a session is on its steps; `waiting` = the same, held on an approval | dispatcher | Active |
| `fixing` | a failure was classified (`failure`) and an attempt is open or scheduled: a retry, a fix session, a fresh session, another model or account | dispatcher, auto-lander | Active |
| `landing` | every step done (or skipped), the PR open, the auto-lander owns it: main merged in, CI, land | dispatcher (the last tick), migration | Complete (to be renamed Landing, UI step) |
| `landed` | the PR merged to main **and** CI green on the merge commit (`landed` evidence) | auto-lander | Archive |
| `complete` | `landed` **and** the feature verify passed (`landed.verifiedAt`) | verify runner | Archive |
| `escalated` | the ladder ran out: banner item + push sent; nothing moves until a hand retries or resets | dispatcher, auto-lander | Errors |
| `built` | **legacy**: the same as `landed`, allowed under the same conditions, never written by the pipeline again; readers treat it as `landed` | (hand, old code) | Archive |
| `failed` | **legacy**: the pipeline no longer writes it (a crash limit is a failure the ladder answers, not an end). Kept for hand use and old records | hand | Errors |
| `blocked` | held by hand, not a failure | hand | Incomplete |
| `archived` | retired | hand | Archive |

`fixing` sits next to `running` on the pipeline table (both show as Building) and is live: a session may be attached;
it is never archived or deleted underneath. `landed` and `complete` are terminal for the pipeline. `escalated` is
terminal until a hand acts (Retry = back to `fixing` with the ladder reset for that kind; Reset = back to `queued`).

### When `landed`, `built` and `complete` are allowed

`guardStatus(build, to, { at })` → `{ ok, why }`, pure; the builds store runs it on every write that **changes** a
status to one of these (a record already at rest in that status is never touched: old records are grandfathered).

| To | Requires on the record |
| --- | --- |
| `landing` | a branch; every step `done` or `skip`; a PR, or `failure.kind = push-fail` instead (then the status is `fixing`, not `landing`) |
| `landed`, `built` | `pr`; `mergedAt` (or `landed.mergedAt`); `landed.sha` (the merge commit on main); `landed.ci = success` with `landed.ciAt` |
| `complete` | everything `landed` needs, plus `landed.verifiedAt` and `landed.verifyHow` (`check`, `playwright`, `deploy`, `hand`) |

CI green on the merge commit means the main workflow run on `landed.sha` finished `success`; a run that was cancelled,
superseded or stale is re-run and never counts as red (landing-line@1's `classifyCheckRun`). Red CI on main after a
merge is a `ci-red` failure on the build (kind `ci-red`, `head` = the merge commit): the build goes back to `fixing`, a
fix session runs on a new branch off main, and `landed` is set only when the fix merged green.

The feature verify is the build's `verify` command (its brief / record; default: its steps' `checks`) run against main
or the deployed console (verify step of this build). A pass sets `landed.verifiedAt` and `complete`; a fail is a
`ci-red` failure with `verifyLog` as the log.

## Failure kinds

`FAILURE_KINDS = crash, ci-red, clash, push-fail, stalled, fell-to-pending`. Every one is classified by the dispatcher's
tick (or by the auto-lander for the two it owns) and written on the build as `failure` (the open failure) and as an
`attempt@1` once the ladder answers it.

| Kind | Detected when | Head | Auto-lander kind |
| --- | --- | --- | --- |
| `crash` | the session's exit is not 0, or it vanished without an end event (today's `crash` / `crash-limit` exit reasons; build-pipeline@1 `nextStatusOnExit`) | branch head | — |
| `ci-red` | CI failed on the branch head (PR checks), on the merge commit on main, or the feature verify failed | the red head | `red-ci` |
| `clash` | the branch conflicts with main in code (`pr-snapshot@1.conflicts`) | branch head | `clash` |
| `push-fail` | a commit could not reach GitHub or no PR could be opened: push rejected, token expired or under-scoped, repo missing, `linkBuild` found no PR after a tick | local head | — (a failed `land` attempt that GitHub refused is reclassified to `push-fail`) |
| `stalled` | a running build with no heartbeat (build-lock beat / events) for `stalledAfterMin`, or an open attempt older than `attemptTimeoutMin` | branch head | (`timeout` result) |
| `fell-to-pending` | a run ended with steps left and the exit transition sent the build to Pending for no reason that needs Brett: `stopped` (a session quit mid-phase without asking), `crash-limit` | branch head | — |

Not failures (waits that are shown, never silent, but not retried): `needs-brett` (a real question, UI Review),
`upgrade-blocked` (a Fable upgrade Brett has not approved while the approval switch is on), `blocked` by hand, a draft
PR, a hold by hand on the lander. Each already lands in Pending with a note; the escalation step puts them on the banner
too, without a retry.

## Records

### attempt@1 — one try at getting past a failure (`attempts[]` on builds@1)

| Field | Meaning |
| --- | --- |
| `n` | the attempt number on this build, 1-based, dense across every kind (what Brett reads: "attempt 4") |
| `kind` | the failure kind it answers (`FAILURE_KINDS`), or `land` for the auto-lander's merge tries, so its attempts live in the same log |
| `strategy` | the ladder rung: `retry`, `merge-main`, `fix`, `fresh-session`, `switch-model`, `switch-account`, `escalate` |
| `fixStrategy` | for `fix`: `targeted` (fix the failing checks), `regenerate` (regenerate generated files and fixtures, re-bake), `redo-step` (merge main in, redo the failing step from its text); `''` otherwise |
| `model` | the model the attempt ran on (`Fable`, `Opus`, `''` for a server-only action) |
| `account` | the Claude account or API key (as the orchestrator records who built it) |
| `session` | the tmux session (`axf-<build>--<agent>`), `''` for a server-only action |
| `step` | the step id it was at (`''` when it is about the PR, not a step) |
| `head` | the sha it started on |
| `pr` | the PR number (0 while there is none) |
| `startedAt`, `endedAt` | ISO; `endedAt` empty while `started` |
| `result` | `started`, `ok`, `failed`, `timeout`, `skipped` (auto-lander-attempt@1's results, same meanings: `timeout` is a `started` attempt past `attemptTimeoutMin`; `skipped` never counts) |
| `log` | a link to the attempt's log (the run's log file, a CI run URL, a journal line), ≤ 300 chars |
| `note` | one plain line: what was tried and how it ended, ≤ 600 chars |
| `source` | who wrote it: `pipeline` (the dispatcher), `auto-lander`, `hand` |

The record is a superset of `auto-lander-attempt@1`: `fromAutoLanderAttempt(a)` maps `kind` (`red-ci` → `ci-red`,
`clash` → `clash`, `land` → `land`), `at` → `startedAt`, `log` excerpt → `note`, and sets `source: auto-lander`,
`strategy: merge-main` for a clash, `fix` / `targeted` for red CI, `retry` for a land. The lander keeps its own
per-PR numbering in its state document; the build's `n` is assigned on the build when the attempt is folded in. At most
60 attempts are kept on the record (oldest dropped into the journal, which keeps every revision).

### failure — the open failure the ladder is working on (`failure` on builds@1)

`{ kind, at, why, head, step, exit }` or `null`. Set when a failure is classified, cleared when an attempt ends `ok`.
It is what the `fixing` chip says ("fixing: CI red on s7 since 02:14").

### landed — the evidence (`landed` on builds@1)

`{ pr, sha, mergedAt, ci, ciAt, ciRun, verifiedAt, verifyHow, verifyLog }` or `null`. `ci` is `success`, `failure`,
`running`, `none` or `unknown` (a legacy record migrated with `mergedAt` and no run recorded). The top-level `mergedAt`
stays (older readers); the two agree.

### escalation — why it stopped (`escalation` on builds@1)

The auto-lander's record plus the rungs: `{ at, kind, attempts, why, head, tried: [ "retry", "fix:targeted",
"fresh-session", "switch-model:Opus", … ], bannerId, pushedAt }`. `null` unless `escalated`. `bannerId` is the
health@1 item; `pushedAt` says the one phone push went (never a second for the same escalation). A hand's Retry clears it
and marks that kind's counted attempts `skipped`, exactly as `auto-lander.resetEscalation` does, so the next try is a
fresh ladder.

### retry-policy@1 — how hard the server tries

| Field | Default | Meaning |
| --- | --- | --- |
| `maxAttempts` | 5 | failures of one kind on one build before it escalates (1..10) |
| `maxTotal` | 10 | failures of every kind together before it escalates (1..30) |
| `retrySame` | 1 | how many times the `retry` rung (same approach) may run per kind |
| `backoff` | `{ baseMin: 2, factor: 2, maxMin: 30 }` | wait after the n-th failure of a kind: `min(maxMin, baseMin × factor^(n−1))` (the auto-lander's formula) |
| `attemptTimeoutMin` | 45 | a `started` attempt older than this is a `timeout` (`stalled`) |
| `stalledAfterMin` | 20 | a running build with no heartbeat for this long is `stalled` |
| `ladders` | see below | the rungs per failure kind, in order |
| `models` | `['Fable', 'Opus']` | the models the server may switch between |

The policy is the `settings` of the `done-means-merged` build rule; without the rule the defaults apply.

## The retry ladder (`framework/core/retry-ladder.mjs`)

`nextStrategy(attempts, failure, policy, { at, pinnedModel, model, account, accounts })` → `retry-decision@1`:
`{ strategy, fixStrategy, model, account, kind, n, rung, tried, notBefore, escalate, reason }`. Pure and deterministic:
the same inputs always give the same answer.

Default ladders (first rung first; a rung is never used twice for one kind):

| Kind | Rungs |
| --- | --- |
| `crash` | `retry` → `fresh-session` → `switch-account` → `switch-model` → `escalate` |
| `ci-red` | `fix:targeted` → `fix:regenerate` → `fresh-session` (`fix:redo-step`) → `switch-model` → `switch-account` → `escalate` |
| `clash` | `merge-main` → `fix:targeted` → `fresh-session` → `switch-model` → `escalate` |
| `push-fail` | `retry` → `fresh-session` → `switch-account` → `escalate` |
| `stalled` | `fresh-session` → `switch-account` → `switch-model` → `escalate` |
| `fell-to-pending` | `retry` → `fresh-session` → `switch-model` → `switch-account` → `escalate` |

Rules, in order:

1. Failures of this kind (`failed` + `timeout`) ≥ `maxAttempts`, or of every kind ≥ `maxTotal` → `escalate`.
2. Inside the backoff after the last failure of this kind → the same decision with `notBefore` set (the runner waits).
3. Walk the kind's ladder; skip a rung already in `tried` for this kind (a `retry` may run `retrySame` times), skip
   `switch-model` when no other model is at or under the step's pin (`pinnedModel`; a step pinned Opus never runs on
   Fable, a step pinned Fable may fall to Opus and come back), skip `switch-account` when every account in `accounts`
   that can run the model was tried. The first rung left is the answer, with `n` = failures + 1.
4. No rung left → `escalate`.

`escalationOf(attempts, failure, { at })` builds the `escalation` record for a decision that says `escalate`.
`ladderFor(kind, policy)` is the rung list the Attempts tab shows as "what will be tried next".

The auto-lander's `decide()` keeps deciding the PR side (merge main, fix session, wait, land) with its own `maxAttempts`
on the PR; when it escalates, the build's ladder takes over with the lander's attempts folded in: a clash the lander could
not merge is `clash` attempt n+1 here (`fix:targeted` in a session), red CI the lander's fix sessions could not clear
goes on to `fresh-session`, `switch-model`, `switch-account`. Only when both ladders ran out is the build `escalated`.

## Migration (`migrateDone`, once; `node framework/cli/builds-store.mjs done-means-merged --dry | --apply`)

Existing `built` and `complete` records that cannot prove a merge move back to where they are:

| Record | Becomes | Why |
| --- | --- | --- |
| `built`, no `mergedAt`, a PR or a branch | `landing` | every step done, not merged: the lander's |
| `built`, no `mergedAt`, no PR and no branch | `fixing` with `failure: push-fail` | nothing ever reached GitHub |
| `built`, `mergedAt` | `landed`, `landed.ci = unknown` | merged, CI on the merge commit not recorded (legacy) |
| `complete`, `mergedAt` | untouched | proven merged; the evidence is `mergedAt` (grandfathered) |
| `complete`, no `mergedAt`, a PR or a branch | `landing` | the merge was never recorded; the lander's first look sets `landed` if it is in fact merged |
| `complete`, no `mergedAt`, no PR, no branch | untouched, listed in the report as `unprovable` | pre-pipeline records (Oct 2026): nothing the server can land or verify |
| deleted or archived | untouched | |

Every moved record gets a note saying what it was and why it moved; `store.meta.doneMeansMerged = { at, moved, unprovable }`
makes the run idempotent. Nothing is dropped; the journal keeps every revision.

## One surface, four transports

The status and the attempts are build fields, so every surface that shows a build shows them; the actions are the
orchestrator's (API step of this build):

| Transport | Where |
| --- | --- |
| Deep link | `row:<build>` (status chip), `row:<build>/tab:attempts` (the expanded row on its Attempts tab; TabGroup `tab:build-orchestrator.build=attempts`), `view:systems-check` (item `builds-escalated`) |
| REST | `GET /api/plugins/build-orchestrator/attempts/<build>`, `POST …/retry/<build>` `{ strategy?, why? }` (Retry: the ladder starts over; a strategy runs at once, never above the pin) | <!-- axf-plugin:build-orchestrator -->
| MCP | plugin commands `attempts` and `retry` of the build orchestrator (plugin-commands@1) |
| CLI | `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs attempts <build>`, `… retry <build> [strategy] [--why w]`; `… pipeline.mjs attempts \| escalated \| retry \| retry-all`; `node framework/cli/builds-store.mjs set-status \| attempt \| fail \| done-means-merged --dry\|--apply`; `… builds-live.mjs link <build> --sha --ci --verified`; `… build-orchestrator/verify.mjs list \| plan \| run` | <!-- axf-plugin:build-orchestrator -->
| Voice (AmberX) | console actions `build-orchestrator.attempts:<build>` ("what's wrong with <build>", "why did <build> stop") and `build-orchestrator.retry:<build>[\|strategy]` ("retry <build> in a fresh session") |

A hand's reset to the Queue is the existing Queue action (`pipeline.mjs queue`); there is no separate reset route.
Every write carries `by` and `reason: { title, description }` and is a journalled store write.

## Related contracts

- `auto-lander@1` (AUTO-LANDER.md): the PR side; its attempt and escalation records are reused as above. Its code lives
  in `framework/core/auto-lander.mjs`, the gate plugin (`apps/console-web/plugins/gate/lander.mjs`) and the push banner's <!-- axf-plugin:gate -->
  lander (`apps/console-web/plugins/push-banner/land/`); there is no `plugins/auto-lander/` folder. <!-- axf-plugin:push-banner -->
- `build-pipeline@1`: the exit transition. `all-done` now lands in `landing`, not `built`; `crash-limit` is a
  `fell-to-pending` failure for the ladder, not an end.
- `build-rules@1` (BUILD-RULES.md): the `done-means-merged` rule and its brief block.
- `health@1` (systems check) and `axf.notify@1`: where an escalation lands.
- `landing-line@1`, `gate-rules@1`: the order and the gate a PR passes; `classifyCheckRun` says what red is.
