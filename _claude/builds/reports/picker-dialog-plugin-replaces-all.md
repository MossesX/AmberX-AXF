# Picker dialog plugin replaces all dropdowns — report

Build `picker-dialog-plugin-replaces-all` · branch `claude/picker-dialog-plugin-replaces-all` · PR #676

Brett said (2026-11-14 18:13): "I want a plugin that replaces all drop down select boxes with a themable dialogue that
matches the theme; skins have to touch them; they must conform to the token system"

Phase 1 (Fable): picker@1 engine, fixtures, picker asset type + `--fx-picker-*` token registry, skin picker target.
Phase 2 (Opus, this report): the React picker, the swap layer, the plugin, its settings and API, migrations, CI gate,
re-bake, tests, help, UI Review.

## What was built

| piece | where |
| --- | --- |
| PickerField (trigger: value, count for multiple) | `framework/react/components/PickerField.tsx` |
| PickerDialog (dialog on desktop, bottom sheet on phones via `data-fx-narrow`, search past the threshold, groups, icons, descriptions, checkboxes + Done for multiple) | `framework/react/components/PickerDialog.tsx`, styles `framework/ui/axf.css` `.fx-picker*` (tokens only) |
| Select (bare drop-down that swaps like SelectField) | `framework/react/components/Forms.tsx` |
| Swap layer + switches | `framework/react/pickerSwap.ts`, `pickerConfig.ts`; AxfProvider installs it, SelectField / Select read it |
| Picker registry (the API's handlers, `window.__axfPickers`) | `framework/react/pickerRegistry.ts` |
| Plugin (removable; on = swap on, off = originals) | `apps/console-web/plugins/picker-dialog/` |
| CI gate | `framework/cli/check-pickers.mjs` + `framework/spec/picker-baseline.json` (30 findings in 21 files) |
| Codemod | `framework/cli/picker-migrate.mjs` (123 selects moved: framework libs, console views, plugins) |

## How each feature is reached (all four doors, one handler set)

Handlers: the console actions `picker.open / choose / toggle / search / clear / close / list`, registered by the plugin,
calling the framework picker registry. Every picker carries `data-axf-target="button:picker-<id>"` (press opens it).

| feature | deep link | REST | MCP | CLI | voice (AmberX) |
| --- | --- | --- | --- | --- | --- |
| settings tab | `console_show view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=picker-dialog`, action `settings.open:picker-dialog` | `GET/POST /api/plugins/picker-dialog/settings` | `picker-dialog_settings`, `picker-dialog_settings-set`, control@1 `setting:axf.picker.*` | `picker.mjs settings` / `set <key> <value>`, `axf picker-dialog settings` | "set picker search threshold to 5" (built-in setting phrase) |
| read pickers on screen | — | `GET /api/plugins/picker-dialog/state` | `picker-dialog_state` | `picker.mjs state` | — |
| open a picker | `console_action picker.open:<id>`, control@1 press `button:picker-<id>` | `POST …/open {target}` | `picker-dialog_open` | `picker.mjs open <picker>` | "open the theme picker" |
| choose | `console_action picker.choose:<id>:<option>` | `POST …/choose {target?, option}` | `picker-dialog_choose` | `picker.mjs choose <option> --in <picker>` | "choose dark", "pick the third one", "choose dark in the theme picker" |
| search / clear / close | `picker.search`, `picker.clear`, `picker.close` | `POST …/search`, `…/clear`, `…/close` | `picker-dialog_search`, `_clear`, `_close` | `picker.mjs search / clear / close` | "search the font picker for mono", "close the picker" |
| tokens | control@1 `tokens.picker` (axf.tokens.picker) | `/api/control` | `control_*` | `axf token …` | — |

Voice: the plugin provides capability `voice-intents@1:picker`; the console voice door (`/api/console-control/voice`,
what AmberX calls) asks providers of `voice-intents@1:*` before its built-in phrases (no plugin named in the console).

## Tests

- `npx -y tsx framework/spec/check-picker-ui.mts` — 47 checks (jsdom): field, dialog, keyboard, search, groups,
  multiple, registry API, swap on/off restores the select byte for byte, SelectField routing. In CI.
- `node apps/console-web/plugins/picker-dialog/test.mjs` — 27 checks: REST / MCP / CLI / voice reach the same actions,
  removable, plugin off = original drop-downs.
- `node apps/console-web/plugins/picker-dialog/e2e.mjs` (Playwright, built console) — 28 checks desktop + phone:
  dialog vs sheet geometry, search, keyboard, multiple native select, colour-theme swap restyles the picker, off restores.
- `check-picker.mts` 662, console-control server 8, check-theme / controls / pickers / toolbars / console-control /
  chrome-assets / banner-widgets / plugin-commands / skin-upgrade / help-coverage / glossary / validate all green.

## Gaps and decisions

- **Skin swap restyle not verified.** In the server-less preview, changing the Settings skin slot does not put the skin
  in force (no skin parts reach the custom sheet), so e2e reports it as a known gap instead of passing it. The colour
  theme swap restyle is verified. Needs a check on a live console.
- **Address kind.** spec/PICKER.md names a `picker:` console-control kind; adding a kind changes console-control@1
  (Fable-pinned contract work), so pickers use `button:picker-<id>` today and every handler accepts `picker:<id>` too.
- **Listbox / combobox swap** (spec § 2 rows 3–4) is not built; only SelectField / Select and native selects swap.
  The catalog marks `ui.picker.swap` partial.
- **30 hand-made drop-downs left** (nested / conditional option lists, uncontrolled selects) in 21 files, held by the
  ratchet; the runtime swap still replaces the native ones.
- **Phase-1 token fix:** `--fx-picker-width` was the menu width (too narrow for a dialog); widened, fixtures regenerated.
- **theme-swap.mjs** drives native selects, so it switches the picker swap off for its run.
- **Shipped-features ledger rows** come from build-hook@1 on the console (the local ledger needs Node 22's sqlite and the
  console's data folder).
- **Kotlin twin** deferred (Android on hold), recorded in spec/PORTING.md by phase 1.

## UI Review

Item `r-20261115-d87ad27e`, group "picker-dialog-plugin-replaces-all - Nov 15 12:05 AM": three looks as picker assets
in `apps/console-web/plugins/picker-dialog/assets/picker/` (Classic, Compact dialog, Sheet everywhere), desktop + phone
shots each. Waiting for Brett.
