# New asset type: animated expanding row picker replaces every dropdown

Build `new-asset-type-animated-expanding-row` · branch `claude/new-asset-type-animated-expanding-row` · PR #630

## Brett said (verbatim, Nov 13 2026 18:13 UTC)
> I don't want drop-down bars anymore. They are gonna be animated. It's gonna be a row with a name and a little arrow;
> when you press that arrow it expands a subgrid; you got to press it again to apply it and close it.

## Phase 1 (Fable, s1–s2)
- `expander-picker@1` asset type (tiles cards / chips / list / swatches, arrow, columns, density, animation, apply rule,
  preview, value on the row, divider), engine `normalizeExpanderPicker` / `expanderPickerStyle`, 8 starters, fixtures,
  customize target, style-package member; React `ExpanderPicker`; `SelectField` draws it.
- `framework/spec/check-expander-picker.mts` conformance check; Kotlin twin deferred (PORTING.md).

## Phase 2 (Opus, s3–s11)
| Step | What changed |
|---|---|
| s3 | The setting's name is inside the collapsed row (left), value on the right, then the arrow; the row button is named "name, value" for readers. |
| s4 | Row or arrow unfolds the grid in place; options take a `preview` node (and `SelectOption.preview`); the opened grid scrolls into view (nearest). |
| s5 | `check-expander-picker-dom.mts` (jsdom, real presses): one press highlights + previews, applies nothing. In CI. |
| s6 | Same option again applies once and closes, focus back on the row; row pressed while highlighted applies; Escape cancels. API: console-control `state` / `set` (value or label) / `press`, unknown and disabled values refused. |
| s7 | Motion token only (`--fx-pick-dur`); scroll waits the token's own duration and is not smoothed under reduced motion; ArrowDown/Up open the row and move focus to the applied option; polite live region ("X highlighted, press again to apply" / "X applied"). |
| s8 | Every pick-one setting in Settings (all plugins' `choice` settings), "Acting as" and the window settings dialog migrated. `framework/cli/check-dropdowns.mjs` in CI: no new raw `<select>`; 230 older ones held per file in `framework/spec/dropdowns-baseline.json` (only goes down). Three looks shot desktop + phone (`shots/`). |
| s9 | Shipped features seed entry (feature@1) and catalog item `ui.expanderpicker` (built). |
| s10 | Acceptance per clause (`new-asset-type-animated-expanding-row/acceptance.md`): measured in Chromium, the unfold runs 256 ms (motion token), instant under reduced motion, pushes content down by its own height, nothing positioned. |
| s11 | Picker row and options carry `data-axf-target` (`button:<picker>-row`, `button:<picker>-<value>`) so the console-control raw-button ratchet stays at its baseline; inventory regenerated. Tests, this report, THREADS row. |

## API (how each part is reached without the UI)
Every picker with its own address is console-control `setting:<address or label slug>`:
- read: `state` → value, options + labels, expanded, highlighted option, asset look
- apply: `set <value|label>` (applies and closes), `press` (opens; with a highlight, applies), `open` / `focus` + expand
- each option and the row: `button:<picker>-<value>` / `button:<picker>-row` (a press = a tap)
- Settings rows keep their own `setting:<key>` target (the picker registers none there).
The same commands run through REST `/api/console-control`, the `console_control_*` MCP tools, `axf control …` and
AmberX voice ("set theme to dark"). The look is the `expander-picker` slot: control@1 `tokens.slots`, `axf token slots`.

## Tests (all green on Nov 15)
check-expander-picker 219 · check-expander-picker-dom 75 · check-theme · check-controls · check-dropdowns ·
check-toolbars · check-chrome-assets · check-console-control (437 = baseline) · check-console-control.mts 290 ·
check-customize 163 · check-approval-expand 74 · check-chrome-settings 282 · shipped-features plugin test (Node 22) 10 ·
`tsc --noEmit` console-web, axhub-web, amberx-droid · console-web `vite build`.

## Gaps / follow-ups
- **UI Review not submitted:** this headless session had no `AXF_CONSOLE_URL` / `AXF_TOKEN`. The shots are in
  `_claude/builds/reports/new-asset-type-animated-expanding-row/shots/`; the submit command is in the build note.
- **230 raw `<select>` left** across console views and plugins (biggest: agent-manager forms 17, ai-assistant settings 14,
  Plan 13). The ratchet stops new ones; each migration is `<select>` → `<SelectField>` plus `check-dropdowns.mjs --update`.
  Toolbar filters (workspace sort, alerts source) need a compact inline look first.
- axhub-web, amberx-droid and molly carry a stand-in `react/controlTargets.ts` (their baked framework predates the
  console-control registry); `rebake.mjs apply` replaces it. molly has no node_modules here, not typechecked.
- walkthrough-studio and demo bake an older framework without the picker; they get it on rebake.
- Kotlin / Compose twin deferred (Android on hold, PORTING.md).
