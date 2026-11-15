# Themed native controls plugin (build `themed-native-controls-plugin`)

Brett, Nov 14 2026: "replace other browser elements like the dropdowns with themed ones"

Phase 1 (Fable): contract `framework/spec/THEMED-CONTROLS.md`, token registry + `themed-controls` asset type (starter
`native`), skin coverage, reference engine `framework/core/engines/themed-controls.ts`, fixture + check.
Phase 2 (Opus, this report): the removable plugin `apps/console-web/plugins/themed-controls`, the framework styles
and the async dialogs API, the API on every transport, tests, help, UI Review. Drop-downs stay the picker dialog's
job (build `picker-dialog-plugin-replaces-all`).

## What shipped

| Family | Replaces | Themed control | Notes |
| --- | --- | --- | --- |
| checkbox | `input[type=checkbox]` | `.fx-tc-check` role=checkbox, aria-checked incl. mixed | Space; label-safe clicks; framework Switch left alone |
| radio | `input[type=radio]` | `.fx-tc-radio` role=radio | arrows / Home / End in the group, roving tab stop, whole group redrawn on change |
| range | `input[type=range]` | `.fx-tc-range` (track, fill, datalist ticks, thumb role=slider, value bubble) | pointer drag, arrows / Page / Home / End, vertical; framework Slider left alone |
| number | `input[type=number]` | `.fx-tc-number` (.fx-input + − / +) | hold-to-repeat from tokens, min / max / step snapping, aria-valuenow |
| datetime | date, time, datetime-local, month, week | typed field + calendar grid / hour-minute(-AM/PM) listboxes | popover on desktop, swipe-down bottom sheet on phone; week start + 12/24 h from token or locale |
| color | `input[type=color]` | swatch + hex field; picker with theme / datalist / recent swatches, S/V area, hue strip | live `input`, `change` on Done, revert on Cancel / Escape |
| dialogs | `window.alert/confirm/prompt` | `.fx-tc-dlg` on `.fx-dialog` (modal / phone sheet) | framework `dialogs.*` Promises; destructive confirms get the danger tone and start on Cancel |
| file | `input[type=file]` | drop zone, file list, per-file progress, aria-live status | accept + multiple; `axf:file-progress` in, `axf:file-cancel` out; page-hidden inputs left alone |
| tooltip | `title` | `.fx-tc-tip` role=tooltip | hover after delay, focus, long-press; aria-description + aria-describedby; every title restored on off |
| scrollbar | browser scrollbars | root class `fx-tc-scroll` | desktop only; webkit rules + scrollbar-color fallback; thin / auto-hide / gutter from tokens |

- **Host** (`web/host.ts`): MutationObserver swap of the active families; the original input stays in the page,
  hidden (`data-axf-themed`), with name / value / validity / form; writes go through the native setter or a click so
  React and forms see a real change; script writes (`el.value =`, `el.checked =`, attributes, form reset) come back
  through instance accessors. Family off, master off or plugin removed: every swap is undone with its current value.
- **Framework**: `.fx-tc*` styles in `framework/ui/axf.css` (every value a `--fx-tc-*` token with today's look as the
  fallback); `framework/react/nativeDialogs.ts` (`dialogs.alert/confirm/prompt`, provider registry, native fallback);
  console re-baked; shared assets (themed-controls `native`, upgraded skins) baked into axhub-web, amberx-droid, molly.
- **Call sites**: 37 `window.alert/confirm/prompt` calls in 13 console plugin files now `await dialogs.*`.
- **Settings**: Settings → Plugins → Themed controls (level toolbar from the settings library): master, phone sheet,
  one switch per family, Tooltips and scrollbars sliders (tokens), What each switch replaces, Install & uninstall.

## How each feature is reached

| What | Deep link / console | REST `/api/plugins/themed-controls/…` | MCP | CLI | Voice |
| --- | --- | --- | --- | --- | --- |
| Settings | `console_show settings:plugins/themed-controls`, `themed-controls.open` | `GET state` | `themed-controls_state` | `axf themed-controls state` | "open the themed controls settings" |
| Master / family / sheet | `setting:axf.themedControls.*`, `themed-controls.toggle`, `.family:<f>:on|off`, `.sheet` | `POST on`, `off`, `family`, `sheet` | `themed-controls_on/off/family/sheet` | `… on`, `… family checkbox off`, `… sheet on` | "turn themed checkboxes off" |
| One control | `setting:field.<ref>` (state, set, focus), `themed-controls.set/get` | `GET controls`, `POST set` | `_controls`, `_set` | `… set start 2026-03-03` | "set the start date to …" |
| Pickers | `panel:themed-controls.datetime|color`, `themed-controls.open/close/pick` | `GET pickers`, `POST open/close/pick` | `_pickers`, `_open`, `_close`, `_pick` | `… open start`, `… pick 14:30` | "open the start date picker" |
| Colours | as above | `GET colors` | `_colors` | `… color c1 red` | "make the colour field red" |
| Dialogs | `panel:themed-controls.dialogs`, `button:themed-controls.dialog.ok|cancel` (OK on a destructive confirm needs confirm) | `GET dialogs`, `POST answer` | `_dialogs`, `_answer` | `… answer ok` | "answer OK" |
| Files | `setting:field.<ref>` set clear / cancel | `GET files`, `POST files` | `_files`, `_files-action` | `… files f1 clear` | "clear the upload field" |
| Tooltip / scrollbar | `setting:themed-controls.<token path>`, `themed-controls.token` | `GET tokens`, `POST tooltip`, `POST scrollbar` | `_tokens`, `_tooltip`, `_scrollbar` | `… tooltip 300`, `… scrollbar 8` | "set the tooltip delay to 300" |
| Every colour / size | control@1 `tokens.controls` | `POST /api/control` | `control_set` | `axf token controls set <path> <v>` | "make the checkbox mark green" |

The switches live in the console's settings; the server keeps the desired values with a revision (data folder
`settings.json`) and pushes a change to the open console through console-control; a console report (`live.json`)
answers what is themed and open on screen.

## Checks

- Playwright `test/themed-controls.spec.ts` (harness page, desktop 1100 + phone 390): **50 passed** — every family
  themed on / native off with values kept, keyboard paths, popover vs bottom sheet, dialogs resolve, destructive
  confirm marked, theme swap restyles.
- `test.py` (server): 11 passed. `plugin-commands check`: 9 reads, 12 commands. `plugin-lifecycle check
  --after-uninstall` (scratch worktree): clean.
- check-theme (1315 files), check-controls, check-toolbars, check-chrome-assets, check-skin-coverage,
  check-themed-controls (315), check-console-control (inventory regenerated), console-control@1 spec, help-coverage,
  glossary catalog --check, shared-assets check, tracker --check, validate --framework (541 assets): pass.
- Console `npm run build` (sync-data, control-inventory, tsc, vite): pass.

## Decisions and deviations

- **`window.confirm` / `window.prompt` keep the browser box.** The contract says the shim returns the Promise, but a
  Promise is truthy: every unconverted `if (confirm(…))` would run a destructive action unasked. They stay native and
  log the call site; `window.alert` (nothing waits for its answer) is themed. Every console call site uses the async API.
- **Addresses**: console-control has no `field` / `dialog` kinds; a themed control is `setting:field.<ref>` and an open
  pop-up is `panel:themed-controls.<family>` (no contract change).
- Pickers and controls are DOM-built (framework classes `fx-btn`, `fx-iconbtn`, `fx-input`, `.fx-popover`,
  `.fx-dialog`, `.fx-tc*`), so they run in any page without a React root; their look is all framework CSS + tokens.
- Destructive confirms are inferred from the message (delete, remove, reset, …) unless the caller says otherwise.

## Waiting / open

- **UI Review**: item `r-20261115-wckr101` (three style presets Native / Bold / Soft, 24 shots desktop + phone, option
  assets in `plugins/themed-controls/assets/themed-controls/`). This session had no console token, so the item is in
  the worktree's data folder only: re-post with `AXF_CONSOLE_URL=… AXF_TOKEN=… node apps/console-web/plugins/ui-review/review.mjs submit … --console`
  (same arguments; shots in `_claude/builds/reports/themed-controls-plugin/shots/`).
- Shipped features rows: written by the build hook on the live console (ledger needs Node 22's sqlite); not readable
  from this session (Node 20, no console token).
- Kotlin twin deferred (Android on hold, `framework/spec/PORTING.md`).
