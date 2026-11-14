# Picker — picker@1

Build picker-dialog-plugin-replaces-all (Nov 14 2026). Brett: "I want a plugin that replaces all drop down select boxes
with a themable dialogue that matches the theme; skins have to touch them; they must conform to the token system".

One contract, three parts:

1. **The picker model** (`framework/core/engines/picker.ts`): a pure engine that turns any list of choices into one model
   (options, groups, icons, descriptions, single or multiple, search threshold, value and labels) and runs its state
   (open / search / move / choose / close) and its keyboard and voice rules. Every port replays
   `spec/fixtures/picker.json` (`spec/check-picker.mts`).
2. **The swap contract**: what counts as a drop-down, how the plugin replaces it without breaking the form it sits in,
   and how a page opts out.
3. **The token family** `--fx-picker-*`: every colour, size, spacing, radius and border the dialog draws with, compiled
   by the theme engine from the active colour theme, style theme and the `picker` asset, so themes and skins restyle
   it like everything else (skin-coverage@1 reaches it through the `picker` style target: box / text / icon / items).

The dialog itself (React `Picker.tsx`, the plugin that swaps native selects, its Plugin Manager entry, its settings
sub-tab and its API surface) is the Opus phase of the build. This file is the contract they implement.

## 1. Picker model

```ts
interface PickerOption {
  value: string;          // what the form gets; unique inside one picker
  label: string;          // what is shown and what voice matches first
  description?: string;   // one line under the label
  icon?: string;          // framework icon id
  group?: string;         // PickerGroup.id; options without one come first, ungrouped
  disabled?: boolean;     // drawn, never chosen, skipped by the keyboard
  keywords?: string[];    // extra words the search and the voice matcher see
}
interface PickerGroup { id: string; label: string }
interface PickerModel {
  id: string;             // stable; the deep-link and voice address of this picker
  label: string;          // the field's label (the dialog header)
  options: PickerOption[];
  groups: PickerGroup[];  // in display order; a group no option names is dropped
  multiple: boolean;      // several values (checkbox rows, Done button) or one (choose = close)
  value: string[];        // the chosen values (one at most unless multiple); unknown values dropped
  searchThreshold: number;// show the search field when options.length >= threshold (default 8; 0 = always, Infinity = never)
  placeholder: string;    // what the trigger says with no value ('' = the first option's label in single mode)
  emptyLabel: string;     // non-empty = a "none" row that clears the value (single mode; a native <option value="">)
  max: number;            // multiple: 0 = no cap, otherwise the most values allowed
}
```

`normalizePicker(raw)` accepts junk and returns a model: strings as `{ value, label }`, `{ label }` alone takes its label
as the value, duplicate values keep the first, labels trimmed and capped at 160 characters, descriptions at 300, at most
2000 options and 100 groups, `value` filtered to known enabled values and cut to one in single mode or to `max`.

`fromNativeOptions(list)` builds the same model from what a native `<select>` holds: `optgroup` labels become groups,
`option.disabled`, `option.selected`, `option.value || option.text`, `data-icon` / `data-description` / `data-keywords`
on an option read as the matching fields. `multiple` and `size > 1` both read as multiple. The engine never touches the
DOM: callers pass `{ value, text, selected, disabled, group, data }` rows.

### Filtering and grouping

- `filterOptions(model, query)` — every query word must match the label, description, keywords or group label (same
  word rules as the search engine's `scoreEntry`: label exact > label prefix > word prefix > substring > elsewhere).
  An empty query returns every option in model order. Disabled options stay (greyed) so a user sees why a word found
  nothing to choose. Results carry `score` for ranking: a non-empty query sorts by score, ties keep model order.
- `groupOptions(model, options)` — `[{ group: PickerGroup | null, options }]`, ungrouped first, then groups in model
  order, empty groups dropped. A grouped list is what the dialog draws; the keyboard walks it flat.
- `searchShown(model)` — `options.length >= searchThreshold`.

### Choosing

- `choose(model, value)` — single: `value` becomes the only value; `''` (the empty row) clears it. Multiple: toggles the
  value; a toggle that would exceed `max` is refused (the model comes back unchanged, `changed: false`). A disabled or
  unknown value never changes anything.
- `selectedLabels(model)` — the labels of the chosen values in option order; `triggerText(model)` = those joined with
  ", " or the placeholder, with `+N` after the first three in multiple mode (`"Red, Green, Blue +2"`).

### State machine

```ts
interface PickerState {
  open: boolean;
  query: string;
  active: number;          // index into the filtered list; -1 = nothing
  filtered: PickerOption[];// what the dialog shows now
  typeahead: string;       // pending type-ahead letters (cleared by the host after PICKER_TYPEAHEAD_MS)
}
```

`openPicker(model)` → open, empty query, every option listed, `active` on the first chosen value or else the first enabled
option. `closePicker(state)` → closed, query and type-ahead cleared. `setQuery(model, state, q)` → the filtered list
and `active` moved to the first enabled result (or -1).

Keyboard (`pickerKey(model, state, key)` → `{ state, model, effect }`; the host maps real key events to these names):

| key | effect |
| --- | --- |
| `ArrowDown` / `ArrowUp` | `active` to the next / previous enabled row, no wrap, disabled rows skipped |
| `Home` / `End` | first / last enabled row |
| `PageDown` / `PageUp` | ten rows down / up (clamped) |
| `Enter` | chooses the active row: single mode → `effect: 'close'`; multiple → toggled, stays open |
| `Space` | multiple: same as Enter; single: nothing while the search field has the focus, else chooses |
| `Escape` | `effect: 'close'`, model unchanged (the trigger keeps the value it had) |
| `Tab` | `effect: 'close'` in single mode (nothing chosen); multiple keeps what was toggled |
| one printable character | type-ahead: appended to `typeahead`, `active` jumps to the first enabled row whose label starts with it (then anywhere in the label), case-folded, accents stripped; with the search field shown the character goes to the query instead (`effect: 'type'`) |

`PICKER_TYPEAHEAD_MS = 700`: the host clears `typeahead` that long after the last letter.

### Choose by name (voice)

`matchByName(model, spoken)` → `{ option, confidence }` or `null`. Case-folded, accents stripped, punctuation dropped.
Order: a label equal to the words (1.0) > a value equal to the words (0.95) > a label that starts with them (0.8) > a
label that contains them as whole words (0.7) > every spoken word found in label + description + keywords (0.5) > one
unique option whose label contains the words anywhere (0.4). Two options at the same best score below 1.0 return `null`
with `ambiguous: [labels]`, so the voice layer can ask. Numbers spoken as "the third one" / "number 3" / "3" pick by
position in the current filtered list (`matchByPosition`). Disabled options never match.

## 2. Swap contract

What the plugin replaces, in every AXF web app it is installed in:

| drop-down | how it is found | the swap |
| --- | --- | --- |
| native `<select>` (single, multiple, with `<optgroup>`) | element name | the select is kept in the DOM, visually hidden (`fx-picker__native`), still the form's value and still what `onChange` fires on; a trigger button drawn with the input tokens stands in its place |
| framework `SelectField` | it renders a `<select class="fx-input fx-field__input">` | same as native: the Field label, hint, error and `aria-describedby` are wired to the trigger |
| custom listboxes | `[role=listbox]` with `[role=option]` children not inside a picker | the options become the model; the host element gets `data-fx-picker="listbox"` and its own `aria-activedescendant` is driven by the engine |
| comboboxes | `[role=combobox]` + `aria-controls` → a `[role=listbox]` | the list is the model, the input is the search field (`searchThreshold` 0); free text stays allowed when the combobox has `aria-autocomplete="list"` |
| plugin ⋯ menus, app menus, context menus | `.fx-dropdown`, `.fx-menubar`, `.fx-ctx` | **not** pickers: they run actions, not values. Left alone. |

Rules:

- **Values never change shape.** The form, the settings registry and every `onChange` see the same strings they saw
  before; the native element is still submitted. Removing the plugin brings the native controls back untouched.
- **Opt out / opt in**: `data-fx-picker="native"` on a select or any ancestor keeps the browser control;
  `data-fx-picker="dialog"` forces the swap on a listbox the finder would skip. The plugin's settings sub-tab
  (Settings → Plugins → Picker) has the same switches app-wide: swap selects, swap listboxes, swap comboboxes, search
  threshold, sheet on phones.
- **Presentation**: a centred dialog on desktop (`fx-picker`, drawn on the framework `Dialog` host so the dialog asset's
  variant, backdrop and animation apply); a bottom sheet with a drag handle on phones (`[data-fx-narrow]`). The header is
  the field's label and a close button; the search field appears at the threshold; options are rows with icon,
  label, description, a check mark on chosen rows; group labels are sticky; multiple mode ends with a Done button and a
  count. Row height is the menu row (`--fx-dens-row-menu`).
- **Accessibility**: trigger `role="combobox" aria-haspopup="dialog" aria-expanded`; the list `role="listbox"`
  (`aria-multiselectable` in multiple mode), rows `role="option" aria-selected`, `aria-activedescendant` follows
  `active`; the focus goes to the search field when shown, else to the list, and back to the trigger on close.
- **API (Brett, Nov 8 2026: everything comes with an API).** Every open picker is a console-control@1 target
  `picker:<id>` (`id` = the select's id, name or the Field label slugged, deduplicated with `-2`, `-3`).
  - deep link: `console_show picker:<id>` / `console_open picker:<id>` opens it;
  - state: `picker.state:<id>` → `{ model, state }` as above (`control get`);
  - actions: `picker.open:<id>`, `picker.close`, `picker.search:<id>:<text>`, `picker.choose:<id>:<value or name>`
    (name goes through `matchByName`), `picker.toggle:<id>:<value>`, `picker.clear:<id>`, `picker.done`;
  - settings: `axf.picker.swapSelects` / `swapListboxes` / `swapComboboxes` (booleans), `axf.picker.searchThreshold`
    (number), `axf.picker.sheetOnPhone` (boolean), `axf.picker.enabled`; all `control set`-able;
  - tokens: control@1 target `tokens.picker` (settings key `axf.tokens.picker`) overrides any `--fx-picker-*` token;
  - voice (console-control-voice@1): "choose <name> in <picker label>", "pick the third one", "close the picker".
  REST, MCP, CLI and voice are the same four doors every console action has; the plugin registers the actions, the
  target kind and the voice intents and says so in its PR.

## 3. Token family `--fx-picker-*`

Compiled by `pickerVars(colorTheme, styleTheme, picker)` in `core/engines/theme.ts` (fixture `theme.json` carries every
starter's values) and written with the other theme variables, so a theme swap moves the picker along. Every default
reads an existing theme token, which is why the defaults match today's dropdown look (`.fx-dropdown` + `.fx-menu__item`
+ `.fx-input`) in every colour theme, light or dark.

| token | default | draws |
| --- | --- | --- |
| `--fx-picker-surface` | `var(--fx-surface)` | the dialog / sheet background |
| `--fx-picker-text` | `var(--fx-text)` | its text |
| `--fx-picker-border` | `var(--fx-border)` | its border |
| `--fx-picker-shadow` | `var(--fx-shadow-lg)` | its shadow |
| `--fx-picker-backdrop` | `color-mix(in srgb, var(--fx-shadow) calc(var(--fx-opacity-scrim) * 100%), transparent)` | the scrim behind it |
| `--fx-picker-header-bg` | `var(--fx-surface2)` | the header row |
| `--fx-picker-header-text` | `var(--fx-text)` | the header label |
| `--fx-picker-search-bg` | `var(--fx-bg)` | the search field |
| `--fx-picker-search-text` | `var(--fx-text)` | its text |
| `--fx-picker-search-border` | `var(--fx-border)` | its border |
| `--fx-picker-search-focus` | `var(--fx-accent)` | its border when focused |
| `--fx-picker-option-bg` | `transparent` | an option row |
| `--fx-picker-option-text` | `var(--fx-text)` | its label |
| `--fx-picker-option-desc` | `var(--fx-muted)` | its description |
| `--fx-picker-option-icon` | `var(--fx-muted)` | its icon |
| `--fx-picker-hover-bg` | `var(--fx-accent-soft)` | hovered row |
| `--fx-picker-hover-text` | `var(--fx-text)` | hovered row text |
| `--fx-picker-focus-ring` | `var(--fx-focus)` | the active row's outline (keyboard) |
| `--fx-picker-selected-bg` | `var(--fx-accent-soft)` | a chosen row |
| `--fx-picker-selected-text` | `var(--fx-text)` | its label |
| `--fx-picker-check` | `var(--fx-accent)` | the check mark |
| `--fx-picker-disabled-opacity` | `max(var(--fx-opacity-disabled), 0.45)` | disabled rows |
| `--fx-picker-group-bg` | `var(--fx-picker-surface)` | a sticky group label row |
| `--fx-picker-group-text` | `var(--fx-muted)` | the group label |
| `--fx-picker-handle` | `var(--fx-border)` | the sheet's drag handle |
| `--fx-picker-radius` | `var(--fx-radius-lg)` | the dialog / sheet corners |
| `--fx-picker-option-radius` | `calc(var(--fx-radius-md) - var(--fx-dens-gap-sm))` | row corners (today's menu item) |
| `--fx-picker-border-w` | `var(--fx-border-w)` | every border |
| `--fx-picker-pad` | `var(--fx-dens-gap-md)` | padding around the list (today's `.fx-dropdown`) |
| `--fx-picker-gap` | `var(--fx-dens-gap-sm)` | gap between rows and between header / search / list |
| `--fx-picker-option-pad-y` | `var(--fx-dens-gap-lg)` | row padding (today's menu item) |
| `--fx-picker-option-pad-x` | `var(--fx-dens-gap-xl)` | |
| `--fx-picker-option-gap` | `var(--fx-dens-gap-2xl)` | icon / label / check gap (today's menu item) |
| `--fx-picker-row-h` | `var(--fx-dens-row-menu)` | row height |
| `--fx-picker-font` | `var(--fx-type-scale-md)` | row text size (today's menu item) |
| `--fx-picker-desc-font` | `var(--fx-type-scale-sm)` | description size |
| `--fx-picker-group-font` | `var(--fx-type-scale-xs)` | group label size |
| `--fx-picker-width` | `min(calc(var(--fx-space) * 46), calc(100vw - var(--fx-dens-gap-2xl) * 2))` | dialog width |
| `--fx-picker-max-h` | `min(70dvh, calc(var(--fx-picker-row-h) * 12 + var(--fx-picker-row-h) * 2))` | dialog height cap (scrolls past it) |
| `--fx-picker-sheet-max-h` | `85dvh` | sheet height cap |
| `--fx-picker-motion` | `var(--fx-motion)` | open / close duration |

States (hover, focus, selected, disabled) are tokens, not CSS literals, so a skin's `parts.picker` can move each one.
The `picker` asset (`assets/picker/*.json`, optional slot, group Controls) names the few choices that aren't a colour
or a size: `variant` (`dialog` | `sheet` | `auto`, default auto = sheet on phones), `search` (`auto` | `always` |
`never`, auto = the threshold), `searchThreshold` (default 8), `checkmarks` (`end` | `start` | `none`), `descriptions`
(boolean), `density` (`compact` | `regular` | `roomy`: scales the row padding), `doneButton` (boolean, multiple mode).
The theme engine folds those into the variables above (density → `--fx-picker-option-pad-*`); the plugin reads the rest
as data attributes (`data-fx-picker-variant`, `-search`, `-check`).

Skins: `data.parts.picker` with the customize tokens (fontSize, textColor, background, borderColor, radius, padding,
itemPadding, gap, hover, hoverColor, iconSet …) lands on the `picker` style target: root `.fx-picker`, items
`.fx-picker__option`. The skin upgrader gives every existing skin a `parts.picker` block that matches its menus.

Checks: `node framework/cli/check-theme.mjs` (no literal colours or sizes in picker CSS), `check-controls.mjs` (the
picker uses framework controls: Button, TextField, Dialog), `npx -y tsx framework/spec/check-picker.mts`,
`node framework/spec/check-skin-coverage.mjs`.

## Kotlin twin

Deferred (Android port on hold, Brett Oct 21 2026; `PORTING.md`): `kernel/engine/PickerEngine.kt` replaying
`picker.json`, `ThemeEngine.kt` emitting the same `--fx-picker-*` values, the `picker` type in `AssetTypeRegistry`
(spec-driven, reads as is) and a Compose `AxfPicker` (dialog / bottom sheet) that the Compose `SelectField` opens.
