# Every UI is fully API-controllable (`ui-api-parity-rule`)

Build `ui-api-parity-rule` (All, Opus, agent Snap Sully, headless r3; r2 died on an expired login before it started).
Branch `claude/ui-api-parity-rule-r3`. Nov 8 2026.

## Brett said (verbatim)

> Standing rule: anything with a UI must have API functions that can do everything the UI can (open, read state, every action, every setting). Voice control is the app's main selling point and rides on this.
>
> 1. Orchestrator: every brief it writes for a build that touches UI includes this requirement explicitly (brief template + brief writer). Keep it short.
> 2. CI check: every registered UI asset/control/plugin view maps to API operations covering its actions and settings; fail when missing; report gaps.
> 3. Audit: list every existing UI lacking full API coverage, starting with the glossary/index Demonstration Designer and Book Builder; fix those two here, add the rest as pending builds.
> 4. Deep link per plugin view (URL that opens it) so agents can open any UI on the phone.

## Built together with `full-api-control`

`full-api-control` (Nov 7) was marked complete but its branch had never been pushed: api-coverage@1 (every UI element
has *some* API path, CI), control@1 `console.values` / `console.elements`, the Terminal drive, the API Browser plugin,
and the "API controls everything" rule + brief-template line. It overlaps items 1 and 2 directly, so this build sits on
top of it (merged, plus main) and both land as **one PR**. That PR is held by full-api-control's waiting UI Review item
`r-20261107-e7b50396` (the API Browser's three looks) until Brett picks one. Its earlier clash note still stands: #329
also appends a control@1 target after `tokens.nav`.

## What changed

**1. The rule in every UI brief.** `API_PARITY_RULE` in the orchestrator's brief writer
(`build-orchestrator/web/orchestrator-core.mjs`, shown when `touchesUi(build)`: UI words in the title, detail or steps,
or a `.tsx` / `web/` file) and in the build manager's (`build-manager/web/orchestrate.mjs`, every brief, beside the asset
rule). Brief template, RULES.md ("Every UI is fully API-controllable"), decisions.md.

**2. CI parity check — ui-api@1** (`framework/cli/ui-parity.mjs`). api-coverage says a control has *a* path; most are
`generic` (press it by its label while it's on screen). Parity wants a named op. Each plugin's plugin.json gets a `ui`
block mapping every view and dialog: `files`, `state` (refs that read what is on screen), `actions` (control label → a
plugin command, console action, setting key …) and `uiOnly` (label → why no op is needed). Refs are validated (an op
that doesn't exist is an error). Gaps = unmapped controls + views without state. `check` fails on errors, on a UI area
whose gaps grow past `framework/spec/ui-parity-baseline.json` (only ever lowered), on a new area with any gap, and on a
mapped view that isn't full. Plus `gaps`, `show`, `audit`, `write-baseline`. The console's own screens and the
framework React layer are areas too. Schema: `plugin.schema.json` → `ui`. CI step in `android.yml`.

**3. Audit + the two fixes.** `_claude/builds/reports/ui-api-parity-rule/audit.md` (`ui-parity.mjs audit`): 67 UI areas
lack full parity, 2549 gaps. Glossary, Index & Demos is the first at **full parity** (5 UIs, 0 gaps):

- *Demonstration Designer*: new commands `demo-new`, `demo-change` (set name / description / app / surface / speed /
  narrator / about, add-step, set-step, move-step, remove-step, chain-add, chain-remove; saved at once) and `demos` now
  takes `q` + `generated` (the list's Search and Only generated). What's on screen is now settings values the API reads
  and sets through `console.values`: `glossary.designer.open` (`demonstration/<id>` | `clip/<id>`), `.tab`, `.mode`,
  `.onlyGenerated`. New console actions (voice): `demo.edit`, `demo.designer` (edit / generate / register / blank),
  `demo.play-step`, `demo.listen`. *Blank* now saves a new demonstration at once (the API and the button do the same).
- *Book Builder*: book ops already existed (`book-new`, `book-change` …); its open book, chapter and tab are now values
  (`glossary.books.open`, `.chapter`, `.tab`), with actions `book.chapter`, `book.tab`, `book.preview` (play an item or
  open its real screen in a floating window) and `book.open:<book>[:<chapter>[:<tab>]]`.
- Every control of both (and of the glossary page and the player) is mapped in its plugin.json `ui`.

The rest went into the orchestrator as pending builds (Opus, one ≤30-min step per area, Brett's words attached):
`ui-api-parity-builds` (14 steps), `ui-api-parity-agents` (18), `ui-api-parity-console` (27), `ui-api-parity-look` (8),
`ui-api-parity-media` (10), `ui-api-parity-framework` (6). Overlaps noted: `universal-voice-api-control-everything-
controllable` s6 (coverage check) ticked as done by this + full-api-control, the rest flagged for re-scoping;
`orchestrator-full-api-control` should be built with `ui-api-parity-builds`.

**4. Deep link per view — deep-link@1** (`framework/core/engines/deep-link.mjs`). `?axf-view=<view>` `&axf-dialog=`
`&axf-settings=<tab>` `&axf-do=<action>` (repeatable). `framework/react/deepLinks.ts`, installed by `AxfProvider` for
every app, opens it once the page is up, waits for a lazy plugin's actions, then strips the params from the address bar.
**A link only opens things**: `axf-do` runs an action only if its `effect` is navigate or read and it isn't person-only;
anything else is refused with a toast. The old `?axf-view=` of the glossary docs keeps working (its own handler is gone).
`node framework/cli/deep-links.mjs` lists all 135 links (46 views, every dialog and settings tab); MCP `console_link`
answers a URL (or the whole list); agents open it on the phone with axHub `amberx.open_url`.

## Contracts

- New: deep-link@1, ui-api@1 (plugin.json `ui`), ui-parity-baseline@1. CONSOLE_TOOLS 12 → 13 (`console_link`).
- No asset type, fixture or Kotlin change. Android twin deferred in PORTING.md (intent URI with the same params + gate).
- `ActionMeta.effect: 'navigate'` added on `demo.play`, `demo.edit`, `demo.play-step`, `book.open`, `book.chapter`,
  `book.tab`, `book.preview` (so links may run them).

## Tests

| Check | Before | After |
|---|---|---|
| `framework/spec/check-ui-parity.mjs` | — | 41 |
| `framework/spec/check-deep-links.mts` | — | 8 |
| glossary-index `test.mts` | pass | pass + 2 (demo ops, ui map) |
| build-orchestrator `test.mjs` | 33 | 34 |
| build-manager `test.mjs` | 128 | 129 |
| `check-console-commands.mts` | 102 (12 tools) | 102 (13 tools) |
| `test_mcp_tools.py` | — | 207 checks, 65 tools |
| api-coverage, plugin-commands, theme, controls, toolbars, chrome-assets, help (264), catalog `--check`, plugin-lifecycle glossary-index, ci-scope, console `tsc` | green | green |

Fixed on the way: the glossary ratchet was 391/388 because full-api-control's API Browser commands had no descriptions
(added); glossary-index lifecycle mentions (RULES.md, THREADS.md). Not mine, still red: `builds-store.mjs verify`
(export drift on `orchestrator-gate`, `console-android-app-tabs`, a breakroom queue entry).

## UI Review

No visible UI changed (labels for screen readers on two Designer buttons; behaviour: Blank saves at once, selection
survives a reload). Nothing new submitted; the PR waits on full-api-control's item `r-20261107-e7b50396`.

## Known gaps

- 2549 gaps in 67 areas, held by the ratchet; the six pending builds take them down.
- Generated docs' live frames still use `?axf-view=` only (fine; now handled framework-wide).
- Deep links are web only; Android deferred.
