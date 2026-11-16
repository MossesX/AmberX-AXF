# Duplicate gate: VPS checks Shipped features before any build is filed or split

Build `duplicate-gate-vps-checks-shipped` (P0, Fable phase 1). Brett, Nov 16 2026 13:06:
"You rebuilt this thing five times over the last three days, even though it's already landed on main. Can we put some
kind of gate on the server? With shipped features? Because shipped features is already on the server."
Follow-up note on the build: build it INSIDE the Gate & rules plugin as a Build rules rule, doer VPS. No new plugin.

## s1 — audit: what exists, what to extend, what is missing

### The case that prompted it (checked against the store)

`auto-land` (PR #270) merged on **Nov 4 2026 00:53** and has a shipped manifest (`sm-auto-land`, landed commit
`3caf0ee0`). After it, the builds store took these records with the same feature:

| Filed | Build | Status | PR |
| --- | --- | --- | --- |
| Nov 10 04:28 | auto-land-every-build-the-moment-it-finishes-red | archived | |
| Nov 13 20:44 | auto-land-every-finished-build-lands | built | #660 |
| Nov 13 23:38 | auto-land-merge-main-land-land-mjs-clash | archived | #660 |
| Nov 14 22:17 | land-finish-auto-land-live-clear-backlog | archived | #678 |
| Nov 15 04:17 | auto-lander-controls-in-the-gate-plugin | built | #705 |

Five records in three days (the last one is the Gate plugin's lander controls, a real extension; the four before it
rebuild what #270 shipped). The live lander config (`/opt/axf/.axf-console/plugins/push-banner/config.json`) had
`autoLand: false` from Nov 4 (the gate-rules fixture `CONFIG_TODAY` records that state on Nov 15); it reads
`autoLand: true` since **Nov 16 13:06**, the minute this build was filed. So the one fix was always the setting, not a
build. Nothing on the VPS looked at the Shipped features store before a build was filed, split or launched.

### What exists (reuse)

| Piece | Where | State | How the gate uses it |
| --- | --- | --- | --- |
| Shipped features store | `_claude/builds/shipped/<build>.json` (shipped-manifest@1), 379 sidecars; `framework/core/shipped-manifest.mjs` (pure), `framework/cli/shipped.mjs` / `shipped-files.mjs` (IO) | live on the VPS, synced to the repo | **the primary corpus**: `build.title`, `said.text` (verbatim), `files`, `areas[].id` (plugin ids), `landedCommit`, `pr`. `searchText()` and `summaryOf()` already exist. A manifest with no `landedCommit` and PR 0 is a *recorded but unlanded* ship (the two earlier dup-check builds are exactly that) and must be scored as kind `build`, not `shipped`. |
| Builds store (builds@1) | `_claude/builds/store.json` (889 records: 389 complete, 233 archived, 209 built, 53 pending, 3 blocked, 1 running, 1 queued); `framework/cli/builds-store.mjs` `loadStore()`; the runner's `buildContext()` reads it | live | the **in-progress corpus**: pending / queued / running / waiting / blocked / built (unlanded) records, with `title`, `detail`, `origin.said`, `branch`, `pr`. Kind `build` matches point at the record instead of filing a new one. |
| Build rules store (build-rules@1) | `framework/core/build-rules.mjs`, live store `/projects/amberx-axf/_data/build-rules/store.json` (rev 4, 118 rules), seed `_claude/builds/build-rules/seed.json` | live, VPS owns it | the gate is **one new rule** `dup-gate` (`doer: vps`, `kind: mechanical`, `phase: before`, `check: fixer:dup-gate`, `autofix: ''`). The registry's `fixers` list is open: add `dup-gate`. |
| Rules runner | `apps/console-web/plugins/gate/build-rules-runner.mjs`: `runPhase(build, 'before')`, `runRule`, `checkerOf` (`fixer:<id>` → `fixers/<id>.mjs` `check(ctx)`), `buildContext(id)`, runs to `runs.jsonl` + gate History (`kind: build-rule`) | live, 'before' runs for every launch (seen in runs.jsonl today) | the fixer module `fixers/dup-gate.mjs` is where the IO lives: gather corpora, call the pure engine, return `{ ok, detail, missing }`. Every block is already logged in History by `writeRuns`. |
| Existing fixers | `fixers/lib.mjs` (`cli`, `result`, `rootOf`), `fixers/shipped-features.mjs` (reads manifests through `shipped-files.mjs`) | live | pattern for the new fixer, including its own CLI `check|fix --build <id> [--json]`. |
| Related rules already in the store | `queue-clash-check` (session, dispatch, judgement), `check-pending-list` (session, dispatch), `no-fable-rebuilds` (vps, before, no check) | enabled, no checker | `queue-clash-check` stays the session's judgement rule for *related* work; `dup-gate` is the mechanical VPS half. Note on both rules so they are not read as duplicates of each other. |
| Dispatcher hook | `apps/console-web/plugins/build-orchestrator/pipeline.mjs` `launch()` → `runBuildRules(id, 'before')` (detached child, results only in History) | live | **gap**: today a failing 'before' rule holds nothing (BUILD-RULES.md says it should hold the build in the Queue). Phase 2 wires the verdict back: `runPhase` synchronously for `dup-gate` at `splitBuild()` and `queue()` / `launch()`, hold with the rule named. |
| Filing points | `orchestrator.mjs act({ action: 'add' })` (CLI, console API, MCP, pending → queue), `pipeline.mjs splitBuild()` / `intake()` | live | the two places "filed or split" happen; both end in `withStore`, so the gate runs before the store write. |
| Lander state | gate plugin `gate-store.mjs` (`gateLander()` → `lander.json`, absent on the VPS today; `landerConfig()` → push-banner `config.json`; `landerRuns()` → `land-runs.jsonl`), `lander.mjs` `mode()` | live | the **on/off source** for a `setting` match: `{ key: 'autoLand', value: true, source: 'push-banner/config.json', since: <mtime or history entry> }`; `gate-rules.mjs` `MIGRATED_KEYS` names every lander key. |
| Gate History | `apps/console-web/plugins/gate/history.mjs` (`gate-history@1`, kinds `rule | lander | build-rule`) | live, 51 entries | blocks and overrides land here as `kind: build-rule`, `id: dup-gate`, actions `pass | fail` (block) and a new `override` action in Phase 2. |
| Plugin inventory | `plugin-inventory@1` (`framework/core/engines/plugins.ts`), `apps/console-web/plugins/*/plugin.json` | live | corpus for kind `plugin` (ids, names, descriptions, `commands.items[].id`); kind `setting` from each plugin's `settings.json` keys plus the lander keys. |
| Earlier dup-check work | `orchestrator-dup-check` (Nov 7, Opus; `redundancy-finding@1`, `dupcheck-core.mjs`, hold setting, phone alert) and `maintenance-redundancy-scan` (`redundancy.mjs` stages) | **recorded in Shipped features, never landed**: both manifests have `landedCommit: ''`, PR 0, branch gone; no file of either exists on main or any branch | nothing to reuse but the design notes (normalised title similarity, shared ids, same files, superseded rounds `-r2` / `-fable`). Their manifests are the live example of a shipped record that must not count as "on main". |
| Fixture + schema conventions | `framework/schemas/<name>.json` (registry snapshot) + `framework/schemas/json/<record>.schema.json` (JSON Schema from `jsonSchemas()`), `framework/spec/fixtures/<name>.json` written by `framework/spec/check-<name>.mjs --write` or `gen-<name>-fixtures.mjs`, contract doc `framework/spec/<NAME>.md`, PORTING.md row | live | dup-gate follows the same shape: `framework/core/dup-gate.mjs` → `schemas/dup-gate.json`, `schemas/json/dup-gate-verdict.schema.json`, `spec/fixtures/dup-gate.json` via `spec/gen-dup-gate-fixtures.mjs`, contract `spec/DUP-GATE.md`. |

### What is missing (this build adds)

1. **dup-gate@1 verdict contract** (s2): `framework/core/dup-gate.mjs` records + `framework/schemas/dup-gate.json` +
   `schemas/json/dup-gate-verdict.schema.json` + `spec/DUP-GATE.md`. Fields: what was checked (corpora, counts, took),
   `matches[]` with `kind: shipped | plugin | file | setting | build`, `score` 0..1, `where` (path, PR, commit, plugin,
   setting key), `state: { on, source, since }`, `fix: { kind: setting | action | reuse, key, value, action, text }`,
   `verdict: block | warn | pass`, `override: { by, at, reason, via }`. Thresholds in the registry
   (`block ≥ 0.82`, `warn ≥ 0.6`, both open to settings).
2. **Matching engine** (s3): pure functions, no I/O. Token normaliser (case, punctuation, plural, camel/kebab split),
   synonym folding table (`auto-land = autoLand = lander = land-on-finish`, `dup = duplicate = redundancy`, `ui review
   = screenshots review`, open to a settings list), weighted fuzzy score: trigram Dice + token Jaccard over title, said
   text, plugin names and settings keys, with field weights; superseded-round folding (`-r2`, `-fable`, `-2`); a
   `verdict(candidate, corpora, options)` entry the fixer calls.
3. **Golden fixtures** (s4): the auto-land case (shipped on main, setting off since Nov 4 → block, fix `autoLand=true`),
   a queued duplicate, a built-but-unlanded duplicate, near-miss titles that pass (e.g. "Lander regenerates generated
   files on clash" vs "auto-land"), and an override that turns a block into pass with the override recorded.
4. **Phase 2 (Opus, after this phase)**: `fixers/dup-gate.mjs` (gather + verdict + History), the `dup-gate` rule in
   seed + live store, synchronous 'before' hold at `add` / `split` / `queue` / `launch`, override command
   (`gate_dup_override` / `axf gate dup override <build> --reason`, voice "build it anyway"), REST
   `GET /api/plugins/gate/dup-gate/<build>`, Build rules tab row + History entries, AmberX push on block, systems check
   when the Shipped store cannot be read, API parity test. No new plugin, no Kotlin (PORTING.md row).

## s2 — dup-gate@1 contract

`framework/core/dup-gate.mjs` (records, `decide`, `reasonOf`, `historyEntry`, validators), registry
`framework/schemas/dup-gate.json`, JSON Schemas `schemas/json/dup-gate-verdict.schema.json` + `dup-gate-match.schema.json`
(through `axf schemas`, wired in `framework/cli/build-engine.mjs`), contract `framework/spec/DUP-GATE.md`, PORTING.md row
(Kotlin twin deferred). Records: candidate, match (kind shipped / plugin / file / setting / build, score, per-field
scores, where, landed, since, state with its source, the one fix), verdict (checked corpora, matches best first, top,
block / warn / pass, reason in one line, fix lifted, override), override (by, at, reason, via). Thresholds default
`block 0.82`, `warn 0.6`, open to the Gate plugin's settings and recorded on every verdict.

## s3 — matching engine (pure)

Same file. Tokens: camelCase split, punctuation out, synonym phrases folded to canonical KEY tokens (`auto land` =
`autoLand` = `lander` = `land on finish` = `lands itself` → `autoland`; `dup` / `redundancy` → `duplicate`; `ui review`,
`shipped features`, `merge queue`, `gate rules`, `push banner`, `home card`, `turn on` …; the fixer may pass more), stop
words and filler adverbs out, light stem. Round markers folded on ids (`-r2`, `-2`, `-fable`, `(round 2)`).

Score of an item = max(subject, text):
- **subject**: how much of the candidate's subject line (title, else the opening words of what was said) the item's own
  subject text (title, setting keys, plugin ids, first 40 words of said / detail) covers, weighted (key tokens 3,
  corpus-common words 0.3, others 1), blended 85 / 15 with the token Jaccard of everything both say. A candidate with
  key tokens needs one of them in the item's **title / keys / plugin ids** (a brief that mentions the lander in passing is
  not the lander). A candidate with no key token needs three plain words, all in the item's title, with the item's title
  covered back by the candidate (the same words both ways, never a subset).
- **text**: weighted mean over title / said / detail (cross-compared, best of the item's three), plugins, settings, files
  (exact key = 1) and id (same folded id = 1) of half trigram Dice + half token Jaccard.

Fix derivation when the item names none: a switched-off thing → `setting key=true` from its state source; an open build
→ `reuse build (PR)`; shipped and on → nothing to build; plugin → extend it.

Calibration on today's store (641 items: 276 landed manifests, 364 open or recorded-only build records, the autoLand
setting): the auto-land rebuild blocks at 0.92 against the setting and 0.87 against the `auto-land` manifest with the fix
"set autoLand to true"; "Lander regenerates generated files on clash", "Auto-lander controls in the gate plugin" and
"Theme sync pane: colour swatches" pass or warn; a re-file of this very build blocks at 0.98 pointing at the running
record. Sweep of every live build record (261) against the rest: 12 would block, every one a real pair already in the
store (`splitter-crash-fix` ↔ `fix-the-step-splitter-crash`, `auto-recover-stuck-builds` ↔
`server-watchdog-orchestrator-auto-recovers-stuck`, `console-app-part-2-native-floating` ↔ `-2`, `every-skin-ships-…`
re-file, `pending-tab-one-collapsed-row-per-2` ↔ `-per-build`, the auto-land case …); the one arguable pair is
`build-statuses-tell-the-truth-orchestrator-list` ↔ `resolve-the-conflict-and-land-the-orchestrator-list`. One check
over the whole store takes about half a second (no model tokens).

## s4 — golden fixtures

`framework/spec/gen-dup-gate-fixtures.mjs` (`--write` regenerates, plain run checks; CI line in android.yml) →
`framework/spec/fixtures/dup-gate.json`. Cases pinned: the auto-land rebuild (on main since Nov 4 with `autoLand` off →
block, fix `autoLand = true`, the `auto-land` manifest among the blocking matches, PR #270), the same from his words only
(no title), a queued duplicate (reuse the queued build), a built-but-unlanded duplicate (reuse the build and its PR), the
same id filed again with a round marker, three near misses that never block, a shipped record that never landed (scored
as a `build` with status `recorded`, never as "on main"), new work (pass), an override that turns the block into a pass
with the override kept, settings thresholds recorded, History entries (fail / override / pass), tokeniser and round
folding samples, validation naming every bad field, and the schema snapshots. 20 checks.

## Phase 2 (Opus) — what is left

The fixer `apps/console-web/plugins/gate/fixers/dup-gate.mjs` (gather manifests, builds, plugin inventory, settings
keys and lander state; `check` → verdict → History), the `dup-gate` rule in the seed and the live store, synchronous
'before' hold at `act add` / `splitBuild` / `queue` / `launch` with the verdict as the build's note, the override
command on every surface (REST, MCP, CLI, voice "build it anyway"), the Build rules row and held-build verdict in the
Gate plugin, AmberX push on block, a systems-check item when the Shipped store cannot be read, API parity test.

### Decisions taken in this audit

- Shipped records count as **on main only when `landedCommit` is a sha or `pr.number > 0` with `mergedAt`**; otherwise
  they are scored as kind `build` (recorded, not landed). The two dead dup-check manifests prove the need.
- The on/off state for a setting match is read from the **lander config**, never from the shipped manifest (manifests
  carry no settings).
- `queue-clash-check` keeps its text; the new rule's `note` points at it so the two are not read as one duplicated rule.
