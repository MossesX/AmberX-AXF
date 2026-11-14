# Picker dialog

Replaces every drop-down select box in the console with the themed picker dialog (picker@1, `framework/spec/PICKER.md`).
Brett, Nov 14 2026: "I want a plugin that replaces all drop down select boxes with a themable dialogue that matches the
theme; skins have to touch them; they must conform to the token system".

## What it does

- Framework `SelectField`s render a `PickerField`; every other native `<select>` gets a picker trigger next to it, with
  the select kept (hidden) as the source of truth, so forms and `onChange` see the same values as before.
- Desktop: a centred dialog. Phones (`data-fx-narrow`, the layout asset's cut-off): a bottom sheet with a drag handle.
- Search past the threshold, grouped sections, icons and descriptions, checkboxes and a Done button for multiple choice.
- Drawn only with the `--fx-picker-*` tokens (`core/engines/theme.ts`), so a theme swap, a skin's `parts.picker` or a
  control@1 `tokens.picker` override restyles it.
- Opt a control out with `data-fx-picker="native"` on it or any ancestor.

The framework owns the picker and the swap layer (`framework/react/PickerField.tsx`, `PickerDialog.tsx`, `pickerSwap.ts`,
`pickerConfig.ts`, `pickerRegistry.ts`); this plugin only switches the swap on from its settings.

## Install / uninstall

```
node apps/console-web/plugins/picker-dialog/install.mjs
node apps/console-web/plugins/picker-dialog/uninstall.mjs [--all]
node framework/cli/plugin-lifecycle.mjs check picker-dialog
```

Disabled or uninstalled = the original drop-downs, untouched. Data folder: `.axf-console/plugins/picker-dialog`.

## API (all four doors, one handler set)

Every picker on screen has an id (`data-fx-picker-id`; the select's id or name, else its label slugged) and the
console-control@1 address `button:picker-<id>` (press opens it). The handlers are the `picker.*` console actions
(`web/actions.ts`), which call the framework picker registry (`framework/react/pickerRegistry.ts`, also
`window.__axfPickers`).

| what | REST | MCP | CLI | voice (AmberX) |
| --- | --- | --- | --- | --- |
| read state | `GET /api/plugins/picker-dialog/state` | `picker-dialog_state` | `picker.mjs state` / `axf picker-dialog state` | — |
| open | `POST …/open {target}` | `picker-dialog_open`, `console_action picker.open:<id>` | `picker.mjs open <picker>` | "open the theme picker" |
| choose | `POST …/choose {target?, option}` | `picker-dialog_choose`, `console_action picker.choose:<id>:<option>` | `picker.mjs choose <option> --in <picker>` | "choose dark", "pick the third one", "choose dark in the theme picker" |
| search | `POST …/search {target?, text}` | `picker-dialog_search` | `picker.mjs search <text> --in <picker>` | "search the font picker for mono" |
| clear / close | `POST …/clear`, `…/close` | `picker-dialog_clear`, `picker-dialog_close` | `picker.mjs clear <picker>`, `close` | "close the picker" |
| settings | `GET/POST …/settings` | `picker-dialog_settings`, `picker-dialog_settings-set`, control@1 `setting:axf.picker.*` | `picker.mjs settings`, `picker.mjs set searchThreshold 5` | "set picker search threshold to 5" |

Deep link to the settings: `console_show view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=picker-dialog`
(or the action `settings.open:picker-dialog`). Voice phrases are claimed through the capability `voice-intents@1:picker`,
which the console's voice door (`/api/console-control/voice`, what AmberX calls) asks before its built-in phrases.
