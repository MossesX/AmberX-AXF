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
