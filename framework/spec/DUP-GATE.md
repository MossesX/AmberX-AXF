# DUP-GATE — dup-gate@1, the duplicate gate before a build is filed, split or launched

Status: contract since Nov 16 2026 (build `duplicate-gate-vps-checks-shipped`, Fable phase; Brett: "You rebuilt this
thing five times over the last three days, even though it's already landed on main. Can we put some kind of gate on the
server? With shipped features? Because shipped features is already on the server."). Reference engine:
`framework/core/dup-gate.mjs` (pure; records, `decide`, `reasonOf`, `historyEntry`, validators; the matcher follows in
the same file). Registry: `framework/schemas/dup-gate.json`; JSON Schemas: `schemas/json/dup-gate-verdict.schema.json`,
`dup-gate-match.schema.json`. Fixture: `framework/spec/fixtures/dup-gate.json` (`spec/gen-dup-gate-fixtures.mjs`).
Audit and reuse plan: `_claude/builds/reports/duplicate-gate-vps-checks-shipped.md`. Kotlin twin deferred (PORTING.md).

## What it is for

The Shipped features store (`shipped-manifest@1`, `_claude/builds/shipped/<build>.json`) already sits on the VPS and
says what landed, with Brett's words, the PR, the landed commit, the files and the plugins touched. The builds store
(builds@1) says what is still pending, queued, running, built or blocked. Nothing read either before a build was filed,
split or launched: `auto-land` landed on Nov 4 (PR #270) with its switch off, and was rebuilt four more times by Nov 15.

dup-gate@1 is **one build rule** (`build-rules@1` id `dup-gate`, `doer: vps`, `kind: mechanical`, `phase: before`,
`check: fixer:dup-gate`) in the Gate & rules plugin. The VPS runs it, plain code, no model tokens, when a build is
filed (`orchestrator act add`), split (`pipeline split`), queued and launched. It answers with one **verdict**: what it
checked, every match best first, block / warn / pass, the reason in one plain line, and the **one fix** that would make
the build unnecessary (a setting to turn, an action to run, or the build / PR to use instead). A block holds the build
where it is with the verdict attached; Brett overrides with one tap or "build it anyway" and the override is kept on the
verdict and in History. Nothing is deleted or edited by the gate.

## Records

### dup-gate-candidate@1 — what is about to be built

`{ $axf, id, title, said, detail, plugins[], settings[], files[] }`. `said` is Brett's verbatim text (build-origin@1),
`detail` the build's description, `plugins` / `settings` / `files` whatever the text or the split names. Null when
there is no text at all.

### dup-gate-match@1 — one thing that already exists

| Field | Meaning |
| --- | --- |
| `kind` | `shipped` = a Shipped features manifest **landed on main** (a sha or a merged PR); `plugin` = a plugin on main; `file` = a file on main; `setting` = an existing setting key; `build` = a builds@1 record not landed yet, or a shipped manifest with no landed commit (`where.status: recorded`) |
| `id`, `title` | what it is: the build / manifest id and title, the plugin id and name, the setting key, the path |
| `score` | 0..1, the weighted fuzzy similarity (`fields` carry the per-field scores and the text each matched against) |
| `where` | `{ path, pr, commit, plugin, key, branch, build, status }`: where it lives. `status` is one of the in-progress builds@1 statuses or `recorded` |
| `landed` | true when it is on main |
| `since` | when it landed (shipped), was filed (build) or was last changed (setting) |
| `state` | `{ on: true \| false \| null, source, key, since }` — whether it is switched on and **where that was read** (`lander-config` = the push banner's `config.json`, `gate-lander`, `plugin-settings`, `plugin-enabled`, `build-options`, or another named reader). Null when it has no switch. Never read from the manifest: manifests carry no settings. |
| `fix` | the one fix: `{ kind: setting, key, value, source }`, `{ kind: action, action, args, text }`, `{ kind: reuse, build, pr }` or `{ kind: none, text }` |
| `note` | one line of context (why it matched, a superseded round, a near miss) |

### dup-gate-verdict@1 — the answer

| Field | Meaning |
| --- | --- |
| `at`, `build`, `rule` | when, the candidate's build id (when it has one), the build rule (`dup-gate`) |
| `candidate` | dup-gate-candidate@1 |
| `checked` | `{ corpora: [{ kind: shipped \| builds \| plugins \| settings \| files, count, source, at }], tookMs, thresholds: { block, warn }, synonyms }` — what was looked at, how big it was, how long it took, the thresholds and synonym table size used |
| `matches` | dup-gate-match@1[], best first, at most 20 |
| `top` | the best match or null |
| `verdict` | `block` (top.score ≥ `thresholds.block`, no override), `warn` (≥ `thresholds.warn`: goes on, History says so), `pass` |
| `blocked`, `pass` | the verdict as booleans, for buttons and voice |
| `reason` | one plain line: what exists, where, on or off since when, and the fix (`reasonOf`) |
| `fix` | the top match's fix, lifted to the verdict so a surface needs one field |
| `override` | dup-gate-override@1 or null |

Defaults: `thresholds { block: 0.82, warn: 0.6 }`, field weights `title 0.45, said 0.25, detail 0.1, plugin 0.1,
setting 0.05, file 0.03, id 0.02`. Both are settings on the Gate plugin; the fixer passes its values in and the
verdict records what it used. `warn` is clamped to `block` so it never sits above it.

### dup-gate-override@1 — "build it anyway"

`{ $axf, by, at, reason, via: console | voice | cli | mcp | api, build }`. `decide(score, thresholds, override)`
turns a block into a pass when an override is present; a warn is never overridden because it held nothing. The
override stays on the verdict and goes to History as action `override`.

## History

Every verdict writes one `gate-history@1` line (`historyEntry`): `kind: build-rule`, `id: dup-gate`, action `pass`,
`fail` (a block) or `override`, `after: { build, phase: before, result, verdict, score, match, fix, override, detail }`,
`reason: { title, description }`. The Gate plugin's History tab shows it with the other build-rule runs.

## Who runs what (Phase 2 of the build, Opus)

| Where | When | What |
| --- | --- | --- |
| `orchestrator.mjs act add` (CLI, console API, MCP, pending → build) | before the store write | the fixer's `check` with the candidate from the request; a block files the build **held** with the verdict as its note, never silently dropped |
| `pipeline.mjs splitBuild` / `intake` | before the split | same check on the record; a block holds it in Pending with the verdict |
| `pipeline.mjs queue` / `launch` | the 'before' phase | `runPhase(build, 'before')` runs `dup-gate` synchronously (today's before-rules run detached and hold nothing: that is the gap this closes for this rule); a fail holds the build in the Queue with the rule named |
| Gate plugin | always | rule row in the Build rules tab, the verdict on the held build, History entries, the Override button; REST `GET /api/plugins/gate/dup-gate/<build>` and `POST …/override`, MCP `gate_dup_check` / `gate_dup_override`, CLI `axf gate dup check <build>` / `override <build> --reason`, voice "is this a duplicate" / "build it anyway" |

Related rules: `queue-clash-check` (session, judgement) keeps asking the session to build *related* work together;
`dup-gate` is the mechanical VPS half for *the same* work. Neither replaces the other.
