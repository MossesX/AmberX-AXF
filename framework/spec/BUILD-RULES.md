# BUILD-RULES — build-rules@1: the builder rules the VPS owns

Status: contract since Nov 15 2026 (build `build-rules-tab-gate-rules-vps-owns`, Fable phase; Brett: "Can we put these in
a build rules tab on the VPS in that rules plugin? Will it enforce it? Will the VPS make sure it builds the home card
instead of Claude? Remove it from Claude so it doesn't build it twice. Remove everything for all the builders from
Claude so it don't happen twice and put them all in that plugin."). Reference engine: `framework/core/build-rules.mjs`
(validate, normalise, load / save under a lock with an append-only history, the store path, `briefBlocks`). Registry:
`framework/schemas/build-rules.json`; JSON Schemas: `schemas/json/build-rule.schema.json`, `build-rules-store.schema.json`,
`build-rule-history.schema.json`. Fixture: `framework/spec/fixtures/build-rules.json` (`spec/check-build-rules.mjs`).
Inventory of today's rules: `_claude/builds/reports/build-rules-tab-gate-rules-vps-owns/inventory.json` (every source
verbatim); seed store: `_claude/builds/build-rules/seed.json` (`framework/cli/build-rules-migrate.mjs`). Kotlin twin
deferred (PORTING.md). <!-- axf-plugin:gate -->

## What it is for

Today every rule a build has to follow is written in several places at once: the Claude rules files, the brief template,
the orchestrator's brief blocks (Look / API / Checkpoints / Rules), the launcher's notes, the rules-brief seed, the console
MCP instructions and the memory docs. A session reads them all and then does the work itself, and the VPS sometimes does
the same work again (the home card was the case that prompted this). build-rules@1 makes the rule set **one document the
VPS owns**: every rule says who does it (`doer`), whether a machine can do or verify it (`kind`), when the VPS acts on it
(`phase`), how it is checked (`check`) and fixed (`autofix`), and which brief block it rides in when the session is the
doer. The VPS Configuration plugin's **Build rules** tab edits it; the dispatcher renders the session's share into the brief;
the VPS runs its own share before, around and after the session, and the gate holds the PR on the rest. A rule is done by
one side, never both.

## Records

### build-rule@1

| Field | Type | Meaning |
| --- | --- | --- |
| `$axf` | `build-rule@1` | |
| `id` | `^[a-z0-9][a-z0-9-]{0,47}$` | stable; the inventory fixes today's ids, a new rule gets a new one |
| `title` | string ≤ 160 | one line, the tab's row |
| `text` | string ≤ 4000 | the rule as the builder reads it: the line the brief sends when the session is the doer |
| `doer` | `vps` \| `session` | **vps** = the VPS does or enforces it by itself (dispatcher, launcher, hooks, gate, CI, a fixer); **session** = the Claude session has to do it |
| `kind` | `mechanical` \| `judgement` | mechanical = a checker, hook or fixer can do or verify it; judgement = it needs reasoning |
| `phase` | `before` \| `dispatch` \| `after` \| `gate` | when the VPS acts: **before** the build is dispatched (queue, model pin, clash check), at **dispatch** (brief and launch context), **after** the session ends or the PR opens (home card, UI Review submission, catalog), or at the **gate** before the PR lands (CI checks, lander policy). A session rule's phase says when its check runs. |
| `enabled` | boolean | off = skipped everywhere: not in the brief, not run, not checked; History says who switched it |
| `check` | string ≤ 600 | `''` = none; a command (`node framework/cli/check-theme.mjs`, starts with `node ` / `npx ` / `python `) or a checker id (`gate:ui-review`, `ci:check-theme`, `store:home-card`). `checkKind(rule)` tells them apart. |
| `autofix` | string ≤ 60 | `''` = none; a fixer id from the registry's open `fixers` list (`home-card`, `scale-adopt`, `ui-review-submit`, `glossary-catalog`, `tracker`, `chrome-settings-backfill`, `shared-assets-bake`, `builds-live-link`). A fixer runs when the check fails and the doer is `vps`. |
| `briefBlock` | `look` \| `api` \| `checkpoints` \| `rules` | which block of the brief carries the text when the doer is `session` (the orchestrator's Look / API / Checkpoints lines and the `## Rules for this job` bullets) |
| `applies` | `builds` \| `interactive` \| `all` | builds = a build session or the pipeline; interactive = only a chat / voice / Claude Code session with Brett present (never in a headless brief); all = both |
| `when` | `{ ui?: boolean, keywords?: string[] ≤ 20 }` | conditions for the brief: `ui` = only builds that change UI (or only those that don't); `keywords` = any of them in the build's title, brief or words. Empty = always. |
| `sources` | `[{ source, file, line, to?, part?, text, pass? }]` ≤ 40 | every place the rule was written before this store, each verbatim (`file:line`, `file:from-to`, `file:line#bullet`); kept for ever so nothing is lost |
| `rev` | integer ≥ 1 | the rule's revision: +1 on every edit or toggle |
| `createdAt`, `updatedAt` | ISO | |
| `updatedBy` | string ≤ 80 | who last changed it (brett, migration, a session name) |
| `note` | string ≤ 600 | optional: why it is set the way it is |

### build-rules-store@1

`{ $axf, rev, at, updatedBy, rules: build-rule@1[] (ids unique, ≤ 400, in tab order), seededFrom?: { file, at, pass, count } }`.
`rev` is the store revision (+1 on every write); `seededFrom` is set once by the migration.

### build-rule-history@1

One line per write, appended to `history.jsonl` and never rewritten:
`{ $axf, at, by, action: seed | migrate | add | edit | toggle | remove | restore, id?, rev (store rev after), ruleRev?, before?, after?, reason: { title, description? } }`.
`seed` / `migrate` carry `count` instead of a rule. `before` / `after` are whole build-rule@1 records (sources left out
of `before` when unchanged). The tab's History view reads it newest first; `restore` puts a rule back to an earlier
`after` and is itself an entry.

### brief-blocks@1 (`briefBlocks(rules, build)`)

Pure. Picks every enabled rule with `doer: session` whose `applies` is `builds` or `all` and whose `when` matches the
build (`{ id, title?, text?, ui?: boolean, words?: string }`), in store order, and renders:

```
{ $axf: 'brief-blocks@1', build, blocks: { look: 'Look: …', api: 'API: …', checkpoints: 'Checkpoints: …', rules: '## Rules for this job\n- …\n- …' },
  lines: { look: [ids], api: [ids], checkpoints: [ids], rules: [ids] }, text, chars, tokens, picked: [ids], skipped: [{ id, why }] }
```

`look`, `api` and `checkpoints` join their rules' texts with a space behind the block's label (one line each, as today's
orchestrator brief has them); `rules` is one bullet per rule. An empty block is left out of `text`. `skipped` names
every rule left out and why (`switched off`, `the VPS does it`, `interactive only`, `UI only`, `no UI`, `keywords: …`).
VPS rules never reach the brief: that is the "not twice" guarantee.

## Who does what, by phase

| Phase | VPS runs | Example rules |
| --- | --- | --- |
| before | the dispatcher, before `launch`: `check` of every enabled `vps` rule with `phase: before`; a failing one holds the build in the Queue with the rule named | `models-opus-fable-only`, `model-per-step`, `small-steps`, `build-origin-verbatim`, `hard-build-limit` |
| dispatch | `briefBlocks` into the brief; launch context (no MCP, lean rules, agent, account, slot) | `rules-brief-only`, `headless-context`, `assigned-agent`, `agent-cap`; every `session` rule's text |
| after | the dispatcher when the session ends or the PR opens: `check`, then `autofix` for `vps` rules; a fixer's result is a build note | `home-card` (fixer `home-card`), `ui-review-submit` (fixer `ui-review-submit`), `glossary-catalog`, `shipped-features`, `builds-live` |
| gate | the gate plugin's rule set: `gate-rules@1` evaluates them per PR; a build rule with `phase: gate` names the gate rule or CI job in `check` | `ui-asset-tokens` → `ci:check-theme`, `toolbars` → `ci:check-toolbars`, `merge-queue-only`, `pr-only` |

Rule #1 of the seed is `home-card`: *every plugin gets a home card, made by the VPS* (`doer: vps`, `phase: after`,
`kind: mechanical`, `check: store:home-card`, `autofix: home-card`). It is not in any brief.

### `done-means-merged` (Nov 17 2026, build `server-rule-done-means-merged-working`)

Brett, Nov 17 2026: *"We asked you to build it. You should do whatever you have to do to build it, period. Why should we
say build it and then it fails and you don't say anything and we find out days later?"* One rule, two sides:

| Side | What | Where |
| --- | --- | --- |
| the brief (`doer: session`, `phase: gate`, `briefBlock: rules`, `applies: builds`, no `when`) | every build brief carries it: never stop on a failure, fix and retry with a different approach, never mark a build built or complete (every step ticked = `landing`), a build note when truly stuck | `briefBlocks` → `## Rules for this job` |
| the VPS (enforced whatever the session does) | the builds store refuses `landed` / `built` / `complete` without a merged PR, CI green on the merge commit and (for `complete`) the verify, and notes the refusal; the dispatcher classifies failures and retries on the ladder; the auto-lander and the verify runner set `landing` → `landed` → `complete`; escalation goes to the systems check banner and one phone push | `guardStatus` / `enforceDoneGuard` (builds-store), `pipeline.mjs`, `retry-ladder.mjs`, health@1 + `axf.notify@1` |

`check: node framework/spec/check-done-means-merged.mjs` (also in CI). It is one of the migration's native rules
(`VPS_RULES` in `build-rules-migrate.mjs`), so the seed carries it and a fresh store starts with it. Its settings are the
retry-policy@1 defaults until build-rule@1 grows a settings field. Contract: `DONE-MEANS-MERGED.md`.

## Store, path and history

The store lives in one folder behind one function, `storeDir()` in the engine: `AXF_BUILD_RULES_DIR` when set, else
`/projects/amberx-axf/_data/build-rules` where the hub is mounted, else `~/.axf/build-rules` (a checkout with no hub).
When the console moves to axf-data the function changes, nothing else. Files: `store.json` (build-rules-store@1),
`history.jsonl` (build-rule-history@1), `store.lock` (an exclusive create; stale after 30 s). `load()` returns the
normalised store, or the seed `_claude/builds/build-rules/seed.json` when the store does not exist yet (and says so with
`seeded: true`). `save(store, { by, reason, action, id, before })` validates, bumps `rev`, writes atomically under the
lock and appends the history line; it refuses an invalid store with every error named.

## Migration (`framework/cli/build-rules-migrate.mjs`)

`inventory.json` → `seed.json`: every inventoried rule becomes a build-rule@1 with its id, title, doer, kind and applies
as inventoried, `phase` and `briefBlock` from the engine's defaults table (session rules: `dispatch` + `rules`, the
orchestrator's Look / API / Checkpoints lines keep their blocks; vps rules: `after`, or `gate` when a CI check exists,
or `before` for queue / model / origin rules), `check` and `autofix` where a checker or fixer exists, and every source
kept. Rule #1 `home-card` is added first. `--check` fails when any inventory rule id is missing from the seed (or from
the live store when one exists), so nothing is dropped by a later edit.

## One surface, four transports (Phase 2: the Build rules tab)

| Transport | Where | Names |
| --- | --- | --- |
| Deep link | console-control `view:gate`, `tab:gate.tabs=build-rules`, `row:<rule id>`, `setting:gate.build-rules.<id>.<field>`; `console_show` / `console_open` take them | `console_open tab:gate.tabs=build-rules` |
| REST | `/api/plugins/gate/build-rules…` | `GET build-rules`, `GET build-rules/<id>`, `PUT build-rules/<id>` (partial; `id` never changes), `POST build-rules` (add), `POST build-rules/<id>/toggle`, `DELETE build-rules/<id>` (confirm), `POST build-rules/<id>/restore` (confirm), `GET build-rules/history`, `GET build-rules/brief?build=<id>` (brief-blocks@1), `GET build-rules/check?build=<id>&phase=…` | <!-- axf-plugin:gate -->
| MCP | the console MCP server through `plugin-commands@1` (and axHub) | `gate_build_rules_list`, `gate_build_rules_get`, `gate_build_rules_set`, `gate_build_rules_add`, `gate_build_rules_toggle`, `gate_build_rules_remove`, `gate_build_rules_restore`, `gate_build_rules_history`, `gate_build_rules_brief`, `gate_build_rules_check` |
| CLI | `axf build-rules …` (`framework/cli/build-rules.mjs`) | `list [--doer vps\|session] [--phase …] [--off]`, `get <id>`, `set <id> <field> <value>`, `add <id> --title … --text … --doer … --kind …`, `on <id>`, `off <id>`, `remove <id>`, `restore <id> <rev>`, `history [--id …] [--since …]`, `brief <build>`, `check <build> [--phase …]`, `migrate [--check]`, `where` (the store path) |
| Voice (AmberX) | console actions `gate.build-rules.open`, `gate.build-rules.toggle`, `gate.build-rules.who` | "open the build rules", "turn off the home card rule", "who does the UI review rule" |

Every write carries `by` and `reason: { title, description }` and lands in History. Every transport answers with the
same records (build-rule@1, build-rules-store@1, build-rule-history@1, brief-blocks@1), so CLI-vs-MCP parity (same input,
same output) is the transport conformance check; the engine's own conformance is `check-build-rules.mjs`.

## What leaves Claude

Once the Build rules tab is live, every rule with `doer: vps` is removed from the briefs, the launcher notes, the
rules-brief seed and the Claude rules files (a one-line pointer to the tab stays where a reader would look), and every
rule with `doer: session` is sent only through `briefBlocks`. The rules files keep what is not a builder rule. That
removal is Phase 2 of this build; this phase changes no rule file.

## Related contracts

- `gate-rules@1` (GATE.md): the gate side. A build rule with `phase: gate` names its gate rule; the gate plugin shows both tabs.
- `rules-briefs@1` (`framework/core/rules-brief.mjs`): today's saved briefs. `briefBlocks` replaces the `core`, `ui` and `plugins` seed briefs' builder lines; what is left in them is Amber's voice and the non-builder lines.
- `build-pipeline@1` (`framework/core/build-pipeline.mjs`): the dispatcher that calls `briefBlocks` at `launch` and runs the before / after phases.
- `build-origin@1`: the verbatim words block the brief starts with; rule `build-origin-verbatim` is the VPS's.
- `done-means-merged@1` (DONE-MEANS-MERGED.md): the status guard, failure kinds, attempts and retry ladder behind rule `done-means-merged`.
- `control@1` (CONTROL.md): read / write / confirm and the deep-link grammar above.
