# GATE — gate-rules@1, the `gate.*` and `lander.*` tools

Status: contract since Nov 15 2026 (build `gate-rules-plugin-in-the-console`, Fable phase; Brett: "Where is the gate and
rules plugin, open it on my screen"). Reference engine: `framework/core/gate-rules.mjs` (pure; `defaultRuleSet`,
`migrate`, `evaluate`, `landerStateFrom`, validators). Registry: `framework/schemas/gate-rules.json`; JSON Schemas:
`schemas/json/gate-rule.schema.json`, `gate-rule-set.schema.json`, `lander-state.schema.json`. Fixture:
`framework/spec/fixtures/gate-rules.json` (`spec/check-gate-rules.mjs`). Design note and the map of today's settings:
`_claude/builds/reports/gate-rules-plugin-in-the-console.md`. Kotlin twin deferred (PORTING.md).

## Who runs what

| Side | Now (console phase of this build) | Later (`move-build-orchestrator-to-axhub`, re-planned) |
| --- | --- | --- |
| **Console** (`apps/console-web/plugins/gate/`) | Runs every tool below. Rules live in the plugin's `lifecycle.dataDir` and are mirrored into the push banner's `config.json` keys the cron lander reads (`landWaitUi`, `queueMode`, `autoLander.*`), so one switch in the Gates tab is the switch the lander obeys. The lander tools call the push banner's `auto-lander@1` / land commands through capability services (never a direct merge). | Keeps the screens (Rules, Auto-lander, History tabs) and its REST, CLI, MCP and voice surface. Its two adapters (`gate-store.mjs`, `lander.mjs`) call `axf-molly` over the internal Docker network instead of the local files. Nothing else changes. | <!-- axf-plugin:gate -->
| **axf-molly** (private container, no public port) | Nothing yet. | Owns the rule set and `lander-state@1`, evaluates `gate.check_pr`, runs the lander and the merge queue, writes `gate.history`. Each rule's `owner` field says when it moved; a rule is never evaluated by both sides. |
| **axHub** | Routes: exposes the tools to Claude sessions with its veto / confirm policy and the caller's credentials, and forwards each call to the side that owns it (the console today, molly later). Never evaluates a rule, never lands anything, has no gate screen. | Same. |

Every write carries `by` and `reason: { title, description }` (axHub's rule for calls that change something) and is
appended to History (`gate.history`). The policy column is the one CONTROL.md uses: `read` runs at once; `write` is a
confirm call on axHub (Brett's one tap, or his standing pass); `confirm` means the tool refuses without a confirm token
(two-step, like a delete).

## gate.*  — the rules and the verdicts

| Tool | Policy | Input | Output |
| --- | --- | --- | --- |
| `gate.rules_list` | read | `{ kind?, enabled?, owner? }` | `gate-rule-set@1` (filtered `rules`, `rev`, `at`, `migratedFrom`) |
| `gate.rules_get` | read | `{ id }` | `gate-rule@1` + `{ default: gate-rule@1 }` (what Reset would give) |
| `gate.rules_set` | write | `{ id, enabled?, severity?, settings?, owner?, by, reason }` (partial; `kind` and `id` never change) | `{ ok, rule: gate-rule@1, before: gate-rule@1, rev }` |
| `gate.rules_toggle` | write | `{ id, enabled: boolean, by, reason }` | `{ ok, rule, rev }` (a shorthand for `rules_set` with only `enabled`) |
| `gate.rules_reset` | confirm | `{ id?, by, reason, confirm? }` — one rule, or the whole set without `id` | first call `{ confirm: token, affects: [ids] }`; second `{ ok, rules: gate-rule-set@1, rev }` |
| `gate.check_pr` | read | `{ pr }` or `{ snapshot: pr-snapshot@1 }` or `{ branch }` | `gate-verdict@1`: `pass`, `held`, `blockedBy`, `agent`, `holds`, `results[]` (`id`, `kind`, `severity`, `verdict`, `reason`), `reasons[]`, `warnings[]` |
| `gate.history` | read | `{ kind?: rule \| lander, since?, pr?, rule?, limit? }` | `{ items: [gate-history@1] }`, newest first |

`gate-history@1` (append-only JSONL in the plugin's `dataDir`): `{ at, by, kind: rule \| lander, action, id?, pr?,
before?, after?, reason }`. `gate.check_pr` with a PR number builds the snapshot from what the lander knows (PR checks,
UI Review hold through `ui-review@1`, conflicts, hand holds) and never changes anything; it is what the Gates tab's
"Check a PR" and the voice line "can 705 land?" call.

Rule ids are fixed by the default set (`merge-queue-only`, `ci-green`, `tests`, `theme`, `controls`, `toolbars`,
`ui-review`, `clash`, `auto-lander`); `custom` rules may be added later through `rules_set` with a new id (same schema),
never through the UI alone. A saved set that predates a default rule gains it on read (`joinDefaults`), so a new server
rule reaches every store without a reset.

`auto-lander` (Nov 16 2026, Brett: "Make the server do it automatically without the console") is the server's policy,
not a gate check: severity `info`, always `pass`. Its `settings` are `auto-lander-policy@1` (`maxAttempts`, `backoff`,
`attemptTimeoutMin`, `mergeMain`, `fixSessions`, `land`, `escalateTo`) and its `enabled` is the lander's own switch; the
VPS runner reads it through `auto-lander.policyFromRules` and obeys it with or without the console. Contract:
`framework/spec/AUTO-LANDER.md`.

## lander.*  — the auto-lander

| Tool | Policy | Input | Output |
| --- | --- | --- | --- |
| `lander.status` | read | `{}` | `lander-state@1` without `waiting` and `lastRuns` bodies: `status`, `enabled`, `paused`, `pause`, `mode`, `landing`, counts `{ waiting, runs }`, `landedRecently` |
| `lander.waiting` | read | `{ rule?, state? }` | `{ items: lander-state@1.waiting }` (each: `position`, `pr`, `title`, `build`, `state`, `rule`, `reason`, `since`) |
| `lander.runs` | read | `{ limit?: ≤ 200, result? }` | `{ items: [auto-lander-run@1] }`, newest first |
| `lander.land_now` | confirm | `{ pr, by, reason, confirm? }` | first call `{ confirm: token, pr, title }`; second `{ ok, pr, position: 0, via: merge-queue }` — puts the PR at the head of the line (`land.mjs queue move <pr> 0` / `lander land-now`); it still passes every rule, never a direct merge |
| `lander.pause` | write | `{ why, by, reason }` | `lander-state@1` with `paused: true`, `pause: { why, by, at }`; the entry in flight finishes, nothing new starts |
| `lander.resume` | write | `{ by, reason }` | `lander-state@1` with `paused: false` |

`lander.status` says `off` when the lander's own switch (`autoLander.enabled`, the one switch from build
`auto-lander-controls-in-the-gate-plugin`) is off; `paused` is the gate plugin's softer hold that leaves the switch alone.
Both are written to History.

## One surface, four transports (all the same calls)

| Transport | Where | Names |
| --- | --- | --- |
| Deep link | console-control addresses `view:gate`, `tab:gate.tabs=overview \| rules \| build-rules \| line \| auto-lander \| limits \| triage \| history`, `row:<rule>` / `row:<pr>`, `setting:gate.<key>`; `console_show` / `console_open` take them | `console_open view:gate` |
| REST | `/api/plugins/gate/…` on the console server | `GET rules`, `GET rules/<id>`, `PUT rules/<id>`, `POST rules/<id>/toggle`, `POST rules/reset`, `GET check?pr=`, `GET history`, `GET lander`, `GET lander/waiting`, `GET lander/runs`, `POST lander/land-now`, `POST lander/pause`, `POST lander/resume` | <!-- axf-plugin:gate -->
| MCP | the console MCP server through `plugin-commands@1` (and through axHub) | `gate_rules_list`, `gate_rules_get`, `gate_rules_set`, `gate_rules_toggle`, `gate_rules_reset`, `gate_check_pr`, `gate_history`, `lander_status`, `lander_waiting`, `lander_runs`, `lander_land_now`, `lander_pause`, `lander_resume` (the dotted names above with `_`) |
| CLI | `axf gate …` (plugin.json `cli: { "gate": "gate.mjs" }`) | `axf gate rules list \| get <id> \| set <id> <field> <value> \| on <id> \| off <id> \| reset [id]`, `axf gate check <pr>`, `axf gate history [--kind …] [--since …] [--pr …]`, `axf gate lander status \| waiting \| runs \| land-now <pr> \| pause --why … \| resume` |
| Voice (AmberX) | console actions `gate.open`, `gate.rule`, `lander.land-now`, `lander.pause`, `lander.resume` | "open the gate", "turn off the UI Review rule", "can 705 land", "what's holding 705", "pause the lander", "resume the lander", "land 705 now" (confirms first) |

Every transport answers with the same record (`gate-rule-set@1`, `gate-rule@1`, `gate-verdict@1`, `lander-state@1`),
so the CLI-vs-MCP parity test (same inputs → same outputs) is the conformance check for the transports; the engine's own
conformance is `check-gate-rules.mjs`.

## Related contracts

- `auto-lander@1` (push banner, build #705): the lander's switch, mode, run record and landing line; `lander.*` here is
  the gate plugin's view on it and calls it, never a second copy of the state.
- `landing-line@1` (`framework/core/landing-line.mjs`): the one-at-a-time lander that replaces the merge queue's stacks
  and batches. `lander-state@1.source` says which one a state came from; `waiting` and `landing` keep their shape.
- `ui-review@1`: the UI Review hold the `ui-review` rule reads.
- `control@1` (CONTROL.md): the policy words (read / write / confirm) and the console deep-link grammar used above.
