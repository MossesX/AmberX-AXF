# skin-check@1 — the skin checker

A plain-code checker (no AI) for any skin or design package. It flags what breaks a professional look, scores the skin, and offers a one-click fix per issue. It runs live in the skin editor, in CI, and through REST, MCP, the CLI and voice. One pure engine, one result shape, every surface the same.

Source of truth: `src/contract.ts` (skin-check@1) and `src/settings-schema.ts` (skin-check-settings@1). This document explains them; where they differ, the code wins.

## What it checks

| Category | Rules | Default severity |
| --- | --- | --- |
| spacing | `spacing.off-scale` (a padding, gap, width or height step off the density gap scale), `spacing.too-many-steps` | warning, info |
| typography | `typography.font-families` (more than N typefaces), `typography.off-scale` (a text size off the type scale) | error, warning |
| palette | `palette.sprawl` (too many distinct colours), `palette.near-duplicate` (two tokens closer than ΔE in OKLab) | warning, warning |
| contrast | `contrast.text` (AA 4.5:1), `contrast.large-text` (3:1), `contrast.ui` (3:1 for icons, borders, control edges) | error |
| shape | `shape.radius`, `shape.border`, `shape.shadow` (a value outside the token set, or too many distinct values) | warning, warning, info |

Rule ids are `<category>.<what>` and are stable keys everywhere: results, settings overrides, deep links, CLI, voice. The list is open; a new rule adds a row to `SKIN_CHECK_RULES` and a file under `src/rules/`.

## What it reads: the subject

The engine never opens a file. The loader (`load-skin.ts`, CI and REST) or the editor (from the assets it holds) builds a `SkinCheckSubject`:

- the skin (`skin@1` data: themes, slot assets, `parts`, `iconPack`), with id, name and kind (skin or design package);
- the colour theme, style theme, typography, density and sizing assets it names, each `{ id, data }` or `null`;
- `vars`: the compiled `--fx-*` map for the look (theme and scale engines), what the page reads.

A missing asset skips the rules that need it; the result lists them under `skipped` with a reason. Nothing throws.

## The issue

```ts
interface SkinCheckIssue {
  id: string;                 // `<rule>@<tokenKey>` or `<rule>@<tokenKey>~<againstKey>` for a pair
  rule: SkinCheckRuleId;
  category: SkinCheckCategory;
  severity: 'error' | 'warning' | 'info';
  token: SkinCheckTokenRef;   // where the value lives: { type, id, path, cssVar? }
  value: string | number;     // as written in the asset
  expected: string;           // in words: "a gap step: 0.25, 0.4, 0.5 …", "at least 4.5:1"
  message: string;            // one plain line (list row, CLI, voice)
  against?: SkinCheckTokenRef;// the other half of a pair (background; canonical colour)
  measured?: number;          // contrast ratio, ΔE, count, distance from the nearest step
  fix?: SkinCheckFix;         // present = one click fixes it
}
```

A token reference names the asset (`skin | color-theme | style-theme | typography | density | sizing`), its id, and the dotted path inside its `data` (`tokens.accent`, `radius.sm`, `gap.md`, `button.padX`, `parts.button.radius`), plus the `--fx-*` variable it compiles to when there is one. Its string form `<type>:<id>/<path>` (`tokenKey`) is what issue ids, `?issue=` deep links, the CLI and voice carry. The editor's jump opens that asset at that path.

A fix is one or more token writes: `{ kind: 'set' | 'merge', label, writes: [{ token, value }], into? }`. Applying a fix is the same operation on every surface. `merge` is a set that also names the canonical token (near-duplicate colours), so the button can say "Merge into accent". Issues the engine cannot decide (palette sprawl, too many steps) carry no fix.

## The score

```
penalty(category) = min(40, Σ weight(severity))     weight: error 10, warning 4, info 1
score             = max(0, 100 − Σ penalty(category)), rounded
pass              = score ≥ settings.minScore and not (settings.failOnError and errors > 0)
```

The per-category cap keeps one runaway rule (forty off-scale paddings) from zeroing the score by itself; a skin that is wrong in every category still lands at 0. Grades are bands for the badge and voice: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F. `scoreIssues(issues, settings)` is the only implementation; the engine, the editor badge, CI and voice all call it.

## The result

`SkinCheckResult` (`$axf: 'skin-check@1'`) is the same JSON from the engine, `GET/POST checker/:skin` (REST), the MCP tools, `axf skin check --json` and the CI artifact: skin `{ id, name, kind }`, `at`, `score`, `grade`, `pass`, `counts` per severity, `byCategory` `{ issues, penalty }`, `issues` (sorted by `sortIssues`: errors first, then category order, then token), `rules` run, `skipped`, the effective `settings`, and `fixable` (how many issues carry a fix).

## Settings: skin-check-settings@1

One field table (`SKIN_CHECK_SETTING_FIELDS`) gives every setting its key, group, kind, default, range, label and hint. Defaults:

| Key | Default | Range |
| --- | --- | --- |
| `minScore` | 80 | 0–100 |
| `failOnError` | true | |
| `spacing.tolerance` | 0.02 | 0–0.25 (fraction of a step) |
| `spacing.maxDistinct` | 12 | 3–40 |
| `typography.maxFamilies` | 2 | 1–6 |
| `typography.sizeTolerance` | 0.02 | 0–0.25 |
| `palette.maxColors` | 12 | 4–48 |
| `palette.nearDuplicateDeltaE` | 2.5 | 0.5–10 |
| `contrast.text` | 4.5 | 1–21 |
| `contrast.largeText` | 3 | 1–21 |
| `contrast.ui` | 3 | 1–21 |
| `shape.maxRadii` | 3 | 1–8 |
| `shape.maxBorderWidths` | 2 | 1–6 |
| `shape.maxShadows` | 3 | 1–8 |
| `rules.<ruleId>` | the rule's default | `error | warning | info | off` |

`normalizeSettings(raw)` fills every field from a flat (dotted keys) or nested document, clamps numbers into range and drops unknown keys; it never throws, so a stored file always loads. `settingsErrors(raw)` is what a write runs first: unknown key, wrong kind, out of range, unknown rule or severity each give one line, and the write is refused. `setSetting(settings, key, value)` is the one-key write the CLI, voice and MCP use; strings are accepted (`"7"`, `"off"`, `"true"`). `settingsJsonSchema()` generates the JSON schema from the table, `settingsGroups()` the panel's sections (Passing plus the five categories, each with its fields and the rules whose severity it sets), `changedSettings()` what differs from the defaults. `ruleSeverity(settings, rule)` is the severity a rule reports with, or `off`.

Persisted in the data folder of the console plugin that hosts the checker (`settings.json`; `AXF_SKIN_EDITOR_DIR` overrides); one document, shared by the console, the CLI and CI on that machine. The last result per skin is kept next to it (`results/<skin>.json`), and applied fixes are written as asset copies under `assets/<type>/<id>.json` that shadow the built-ins for the checker; built-in asset files are only rewritten by `axf skin fix … --in-place`.

## The engine interface

```ts
interface SkinCheckEngine {
  rules(): readonly SkinCheckRule[];
  check(subject, settings?, now?): SkinCheckResult;
  applyFixes(subject, result, issueIds): SkinCheckApplied;   // { subject, writes, fixed, unfixable }
  applyAllFixes(subject, result): SkinCheckApplied;
  write(subject, { token, value }): SkinCheckSubject;
}
```

Pure: the same subject and settings give the same result; `now` is injectable for reproducible tests. A rule is `{ meta, needs, run(ctx) }`: `meta` is its row in `SKIN_CHECK_RULES`, `needs` the subject assets it cannot work without (the engine skips it when one is null), and `run` reports through `ctx.report(...)`, which fills in the id, category and the effective severity. Applying fixes returns the writes so the caller persists them: the editor writes the asset in memory and re-runs, the REST route writes the asset files, the CLI prints them (or writes with `--write`).

## Surfaces

`SKIN_CHECK_SURFACES` is one table of every action with its REST route, MCP name, CLI form and voice intent. The route file, the MCP tools, the CLI and the voice intents are generated from or checked against it, and the parity test calls every action through every surface and expects the same JSON.

| Action | REST (under the hosting console plugin's mount, `…/checker`) | MCP | CLI | Voice |
| --- | --- | --- | --- | --- |
| check | `POST /:skin/check` | `skin_editor_check` | `axf skin check <skin>` | `skin.check` |
| state | `GET /:skin` | `skin_editor_state` | `axf skin check <skin> --cached` | `skin.check.state` |
| fix | `POST /:skin/fix` `{ issues }` | `skin_editor_fix` | `axf skin fix <skin> <issueId…>` | `skin.check.fix` |
| fix_all | `POST /:skin/fix-all` | `skin_editor_fix_all` | `axf skin fix <skin> --all` | `skin.check.fix.all` |
| settings_get | `GET /settings` | `skin_editor_settings_get` | `axf skin settings` | `skin.check.settings.get` |
| settings_set | `PUT /settings` | `skin_editor_settings_set` | `axf skin settings set <key> <value>` | `skin.check.settings.set` |
| settings_reset | `DELETE /settings` | `skin_editor_settings_reset` | `axf skin settings reset` | `skin.check.settings.reset` |
| open | `GET /link?skin=&issue=` (the link); `console_show` opens it | `console_show` target `skin-editor/checker` | `axf skin open <skin> [issueId]` | `skin.check.open` |

Also `GET /skins` (`skin_editor_skins`, `axf skin list`): every skin and design package with its last score.

One implementation: `src/core.ts` holds every handler. The hosting console plugin's Python routes run it through `bin/skin-check.mjs call <action> '<json>'`, the CLI calls it in-process, the MCP tools are the plugin's commands (generated from plugin.json) and the voice intents run those commands. `bin/skin-check.mjs` runs the TypeScript with Node's type stripping (Node 22.6+) or tsx.

Deep link: `skin-editor/checker?skin=<id>&issue=<issueId>` (`skinCheckLink`) opens the panel on that skin and scrolls to the issue. `state` returns the last result kept per skin and runs a check when there is none; `check` runs and replaces it. `axf skin check` exits 0 when the skin passes, 1 when it does not (CI), 2 on a usage or load error; `--all` checks every skin and fails if any does not pass.

## Kotlin twin

Deferred (no new Android or Kotlin work; framework/spec/PORTING.md, "skin-check@1"). A port replays the same issue shape, score formula, settings table and result JSON.
