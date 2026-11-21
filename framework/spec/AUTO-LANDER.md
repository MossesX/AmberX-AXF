# AUTO-LANDER — auto-lander@1, the server fixes and lands every build on its own

Status: contract since Nov 16 2026 (build `server-auto-lander-fixes-lands`, Fable phase). Brett, Nov 16 2026: "We need
the auto lander to bang shit out on its own. It needs to automatically fix it. We need a server rule to do that. Make the
server do it automatically without the console."

Reference engine: `framework/core/auto-lander.mjs` (pure: `decide`, `apply`, `startAttempt`, `endAttempt`,
`fromLanderState`, `policyFromRules`, validators). Registry: `framework/schemas/auto-lander.json`; JSON Schemas:
`schemas/json/auto-lander-attempt.schema.json`, `auto-lander-build.schema.json`, `auto-lander-policy.schema.json`,
`auto-lander-action.schema.json`, `auto-lander-state.schema.json`. Fixture: `framework/spec/fixtures/auto-lander.json`
(`spec/check-auto-lander.mjs`). Server rule: `auto-lander` in the default `gate-rule-set@1` (GATE.md). Kotlin twin
deferred (PORTING.md).

## What it is

The gate (`gate-rules@1`) says whether a PR may land. The landing line (`landing-line@1`) says in which order. This
contract is the part in between that used to need a hand: when a PR cannot land, the server itself does the next thing,
again and again, until the PR lands or the policy says stop.

- A **clash** with main: the server merges main into the branch and pushes.
- **Red CI**: the server starts a fix session on the branch (the build's own account, a new session) and waits for the
  new head.
- **CI running** or not started: the server waits.
- **Green**: the server lands it.
- Too many tries of the same kind: the server **escalates**: the build stops, a systems check banner item says what was
  tried, and nothing else happens until a hand resets it.

The engine is pure. The VPS runner (the push banner's cron lander today, `axf-molly` later) reads the rule, builds the
`pr-snapshot@1` the gate already uses, calls `decide`, carries the action out, and records the attempt. The console is
a window on it, never a part of it: the rule is enforced server-side, with or without the console open.

## Records

### auto-lander-attempt@1 — one try

| Field | Meaning |
| --- | --- |
| `build` | the build id (builds@1) |
| `kind` | `clash` (merge main in), `red-ci` (fix session), `land` (merge the PR) |
| `n` | the attempt number for this build and kind, 1-based, dense |
| `account` | the Claude account or API key that did it (as the orchestrator records who built it) |
| `session` | the session id (empty for a server-only action such as merging main) |
| `branch`, `head` | the branch and the head sha the attempt started on |
| `pr` | the PR number (0 while there is none) |
| `result` | `started`, `ok`, `failed`, `timeout`, `skipped` |
| `log` | an excerpt of the output (≤ 2000 chars): the conflicting files, the failing checks, the merge error |
| `at`, `endedAt` | when it started and when it ended (empty while `started`) |

`timeout` is what a `started` attempt becomes once it is older than `attemptTimeoutMin` without an end: the runner
counts it as a failure and tries again. `skipped` is an attempt the runner did not carry out (policy switched off
mid-flight, PR closed); it never counts as a failure.

### auto-lander-build@1 — one build in the lander

| Field | Meaning |
| --- | --- |
| `build`, `pr`, `branch`, `head` | what it is |
| `state` | `waiting`, `merging-main`, `fixing`, `ci-running`, `landing`, `landed`, `escalated` |
| `since` | when it entered this state |
| `at` | when the record was last written |
| `attempts` | its `auto-lander-attempt@1` records, oldest first (≤ 60 kept) |
| `reason` | why it is in this state, in plain words (what the console, CLI and voice say) |
| `escalation` | `{ at, kind, attempts, why, head }` once escalated; `null` otherwise |

States: `waiting` (nothing to do right now: CI not started, backoff, UI Review, a hold by hand, draft), `merging-main`
(a clash attempt is open), `fixing` (a red-ci attempt is open: a fix session runs), `ci-running` (CI runs on its head),
`landing` (a land attempt is open), `landed` (terminal), `escalated` (terminal until a hand resets).

```
waiting ──clash──▶ merging-main ──ok──▶ ci-running ──green──▶ landing ──ok──▶ landed
   ▲                  │ failed              │ red                 │ failed
   │                  ▼                     ▼                     ▼
   └──── backoff ◀── (n < max)  ◀───── fixing ◀── (n < max) ◀────┘
                           │ n = maxAttempts
                           ▼
                       escalated
```

### auto-lander-policy@1 — how hard it tries

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | the rule's switch |
| `maxAttempts` | `3` | failures of one kind on one build before it escalates (1..10) |
| `backoff.baseMin` | `5` | minutes before the second try |
| `backoff.factor` | `3` | each further wait is the last one times this |
| `backoff.maxMin` | `60` | the longest wait |
| `attemptTimeoutMin` | `45` | a `started` attempt older than this is a `timeout` |
| `mergeMain` | `true` | a clash merges main in (off: a clash escalates at once) |
| `fixSessions` | `true` | red CI starts a fix session (off: red escalates at once) |
| `land` | `true` | green lands (off: green waits; the hand lands) |
| `escalateTo` | `banner` | `banner` (systems check item with the attempts), `note` (build note only), `none` |

`backoff(n)` = `min(maxMin, baseMin × factor^(n−1))` minutes after the n-th failure of a kind: 5, 15, 45, 60, 60 …

The policy is the `settings` of the `auto-lander` gate rule (`policyFromRules(ruleSet)`); the rule's `enabled` is the
policy's `enabled`. Without the rule the engine uses the defaults, so an old rule set still lands on its own.

### auto-lander-action@1 — what `decide` answers

| Field | Meaning |
| --- | --- |
| `action` | `merge-main`, `fix-session`, `wait`, `land`, `escalate`, `none` |
| `state` | the state the build is in after this action is taken |
| `kind` | the attempt kind the action belongs to (`clash`, `red-ci`, `land`; empty for wait / none) |
| `attempt` | the `n` of the attempt the action starts (0 for wait / none / escalate) |
| `notBefore` | for a backoff wait: when the next try may start (ISO); otherwise empty |
| `waitReason` | for a wait: `switched-off`, `ci-running`, `ci-none`, `in-flight`, `backoff`, `ui-review`, `held`, `draft`, `fork`, `no-pr` |
| `reason` | plain words |

### auto-lander-state@1 — every build the lander tracks

`{ $axf, at, policy: auto-lander-policy@1, builds: [auto-lander-build@1], migratedFrom? }`. One document on the VPS
(the lander's data dir), written by the runner only; the console, CLI, MCP and voice read it.

## decide(build, prState, attempts, policy, { at })

`prState` is the gate's `pr-snapshot@1` (`gate-rules.normSnapshot`), so the lander and the gate see one PR the same way.
In order:

1. Policy off → `none` (`switched-off`); `landed` or a merged PR → `none` (`landed`); `escalated` → `none` until reset.
2. An open attempt (`started`, not yet `attemptTimeoutMin` old) → `wait` (`in-flight`), state unchanged. An older one
   counts as a `timeout` failure and the decision goes on.
3. A draft, a fork, a hold by hand, no PR yet → `wait` with that reason.
4. A code clash → kind `clash`; else red CI → kind `red-ci`; else CI running → `wait` (`ci-running`, state
   `ci-running`); CI not run → `wait` (`ci-none`); UI Review holding → `wait` (`ui-review`); else kind `land`.
5. For the kind: failures (`failed` + `timeout`, every head) ≥ `maxAttempts` → `escalate`. The kind switched off in the
   policy → `escalate` at once (there is nothing the server may do). Inside the backoff after the last failure → `wait`
   (`backoff`, `notBefore`). Otherwise the kind's action with `attempt` = failures + 1.

Every head counts: a fix session that pushes a new head and is red again is attempt 2 of `red-ci`, not attempt 1 of a
new build. A reset by hand (`resetEscalation`) clears the escalation and drops the counted attempts into history, so the
next try is attempt 1 again.

## Migration from lander-state@1

`fromLanderState(state, { policy, at })` reads what the gate plugin shows today and writes `auto-lander-state@1`:

| lander-state@1 | auto-lander-build@1 |
| --- | --- |
| `landing` with `ci: running` | `ci-running` |
| `landing` otherwise | `landing` |
| `waiting[]` with rule `clash` | `waiting`, reason kept (the next decide merges main) |
| `waiting[]` kicked / rule `ci-green` and red | `waiting` + one `red-ci` attempt `failed` with the `why` as log |
| `waiting[]` rule `ci-green`, running | `ci-running` |
| `waiting[]` held / skipped / draft | `waiting`, reason kept |
| `landedRecently[]` | `landed` |

No record is dropped; `migratedFrom: { frame: 'lander-state@1', at }` says it was a migration.

## One surface, four transports

The lander has no screen of its own in this build; it is enforced server-side. Where it is read and driven:

| Transport | Where |
| --- | --- |
| Deep link | `view:gate`, `tab:gate.tabs=rules`, `row:auto-lander` (the rule), `tab:gate.tabs=auto-lander` (the state) |
| REST | `/api/plugins/gate/rules/auto-lander` (`GET`, `PUT`, `POST …/toggle`), `GET /api/plugins/gate/lander` (state) | <!-- axf-plugin:gate -->
| MCP | `gate_rules_get { id: 'auto-lander' }`, `gate_rules_set`, `gate_rules_toggle`, `lander_status`, `lander_waiting` |
| CLI | `axf gate rules get auto-lander`, `axf gate rules set auto-lander maxAttempts 5`, `axf gate rules on\|off auto-lander`, `axf gate lander status` |
| Voice (AmberX) | `gate.rule` ("turn off the auto-lander rule", "set the auto-lander to five tries"), `lander.status` ("what's the lander doing") |

Every write carries `by` and `reason: { title, description }` and lands in `gate.history`.

## Related contracts

- `gate-rules@1` (GATE.md): the rule set this policy lives in and the `pr-snapshot@1` the decision reads.
- `landing-line@1`: the order; its `landing-attempt@1` is the line's per-entry log, this one is the server's per-kind
  retry record. The runner writes both.
- `health@1` (systems check): where an escalation lands as a banner item with Fix.
- `build-origin@1` / builds@1: `account` on an attempt is the same account the orchestrator records as the builder.
