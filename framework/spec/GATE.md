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
| **Console** (`apps/console-web/plugins/gate/`) | Runs every tool below. Rules live in the plugin's `lifecycle.dataDir` and are mirrored into the push banner's `config.json` keys the cron lander reads (`landWaitUi`, `queueMode`, `autoLander.*`), so one switch in the Rules tab is the switch the lander obeys. The lander tools call the push banner's `auto-lander@1` / land commands through capability services (never a direct merge). | Keeps the screens (Rules, Auto-lander, History tabs) and its REST, CLI, MCP and voice surface. Its two adapters (`gate-store.mjs`, `lander.mjs`) call `axf-molly` over the internal Docker network instead of the local files. Nothing else changes. | <!-- axf-plugin:gate -->
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
UI Review hold through `ui-review@1`, conflicts, hand holds) and never changes anything; it is what the Rules tab's
"Check a PR" and the voice line "can 705 land?" call.

Rule ids are fixed by the default set (`merge-queue-only`, `ci-green`, `tests`, `theme`, `controls`, `toolbars`,
`ui-review`, `clash`); `custom` rules may be added later through `rules_set` with a new id (same schema), never through
the UI alone.

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

## Land order — land-order@1, the `order` block of lander-state@1

Status: contract since Nov 17 2026 (build `auto-lander-drag-rows-to-set-merge-order`, Fable phase; Brett: "I want to
reorder the order that they're gonna be merged in."). Reference engine: `framework/core/land-order.mjs` (pure: records,
`reconcile`, `move`, `next`, `migrate`); JSON Schema `schemas/json/land-order.schema.json` (also embedded in
`lander-state.schema.json` as `order`); fixture `framework/spec/fixtures/land-order.json` (`spec/check-landing-line.mjs`
and `spec/check-gate-rules.mjs` replay it, `--write` regenerates). The lander lands one at a time; this record says **in
which order**. Brett drags rows in the Auto-lander tab (several at once), the lander follows the list.

### Record

```
order: { $axf: 'land-order@1', rev, source: default | brett, updatedAt, updatedBy, items: [{ id, pr, build, behind? }], migratedFrom?: { frame, at } }
```

| Field | Meaning |
| --- | --- |
| `items` | top lands first; ids unique, ≤ 200. `id` is the landing-line entry id (`pr-<n>`, or `build-<id>` while the PR is not open yet), `pr` the PR number (0 = none yet), `build` the build id ('' = a PR with no build), `behind` commits behind main when known |
| `source` | `default` = the engine's sort; `brett` = a hand set it (any transport) and it is kept as it is until Reset |
| `rev` | +1 on every change, by hand or by reconcile; `updatedAt` / `updatedBy` say when and who (`brett`, a session name, '' for the engine) |
| `migratedFrom` | set once when the order was first built from `merge-queue@1` (the control document's `order` + the queue's items) or `landing-line@1` (the line's entries) |

### Rules (the engine keeps them; every transport gets the same answer)

- **Default order** = closest to main first: `behind` ascending; items with no `behind` go last; ties keep the line's
  position. While `source` is `default`, every reconcile re-sorts.
- **New PRs append at the bottom**, whatever the source: a hand order is never re-sorted under Brett's feet.
- **Merged / closed PRs drop out**; the rest keep their relative order. A PR that comes back (reopened, re-added) appends.
- **A hand move sets `source: brett`** and bumps `rev`; `move(order, ids, to)` takes one or several ids (multi-select) and
  a place: `top`, `up`, `down`, `bottom`, or `{ index }` (0 = top). The selected rows move together, in their current
  relative order; `up` / `down` move the block one place; nothing moves ahead of the entry in flight (landing now).
- **Reset** puts the order back to `default` (one confirm; the next reconcile re-sorts).
- **Next** = the first item in the order that is open, waiting and not blocked / held / paused / in flight. A blocked
  row keeps its place; the lander passes over it and comes back when it is free.
- **The waiting list follows the order**: `lander-state@1.waiting[].position` is the row's place in `order.items`
  (1-based); `landing` and every waiting PR appear in `order.items`, and the order names no PR that is not one of them
  (`landerStateErrors` checks both ways).

### Migration

The first state built after this contract lands carries `order` from what the lander had: the merge queue's manual
order (`merge-queue-control@1.order`) first, then the queue's `items` and `waiting` in their order (that is also the
landing line's order after `migrateMergeQueue`); `source: default` unless the control document had a manual order
(then `brett`, `updatedBy: migration`). A lander on `landing-line@1` takes the line's entries in line order. Nothing is
dropped: an item the order does not know is appended, one the line no longer has is dropped.

### One surface, four transports

| Transport | Where | Names |
| --- | --- | --- |
| Deep link | `view:gate`, `tab:gate.tabs=auto-lander`, `row:<pr>` (the row to drag), `setting:gate.lander.order` | `console_open tab:gate.tabs=auto-lander` |
| REST | `/api/plugins/gate/lander/order` | `GET lander/order` (the block), `POST lander/order/move` `{ ids, to: top \| up \| down \| bottom \| index, index?, by, reason }`, `PUT lander/order` `{ ids, by, reason }` (the whole list), `POST lander/order/reset` (confirm) |
| MCP | the console MCP server through `plugin-commands@1` (and axHub) | `lander_order`, `lander_order_move`, `lander_order_set`, `lander_order_reset` |
| CLI | `axf gate lander order`, `axf gate lander move <pr…> --to top \| up \| down \| bottom \| <index>`, `axf gate lander order set <pr…>`, `axf gate lander order reset` | |
| Voice (AmberX) | console actions `lander.order`, `lander.move`, `lander.order-reset` | "land 705 first", "move 705 and 706 to the top", "put 705 after 706", "back to the default order" |

Every write carries `by` and `reason: { title, description }` and lands in History (`gate.history`, kind `lander`,
action `order`). The transports are Phase 2 of the build; this phase ships the record, the engine and the fixture.

## One surface, four transports (all the same calls)

| Transport | Where | Names |
| --- | --- | --- |
| Deep link | console-control addresses `view:gate`, `tab:gate.tabs=rules \| auto-lander \| history`, `row:<rule>` / `row:<pr>`, `setting:gate.<key>`; `console_show` / `console_open` take them | `console_open view:gate` |
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
