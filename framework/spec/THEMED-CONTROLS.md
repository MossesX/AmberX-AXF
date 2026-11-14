# Themed native controls — themed-controls@1

Brett (Nov 14 2026): "replace other browser elements like the dropdowns with themed ones". Drop-downs are the picker
dialog's job (picker@1, build picker-dialog-plugin-replaces-all). This contract covers every other browser-drawn
element: the controls the browser paints itself and the dialogs it opens itself. A removable console plugin
(`apps/console-web/plugins/themed-controls`, phase 2) swaps them for framework controls drawn from tokens; this file is
the contract the plugin, the reference engine, the token family and every API transport follow.

Reference engine: `framework/core/engines/themed-controls.ts` (+ `themed-controls-rules.mjs`, the field registry shared
with the build engine). Fixture `framework/spec/fixtures/themed-controls.json`, check `framework/spec/check-themed-controls.mts`.
Kotlin twin deferred (Android on hold, `PORTING.md`).

## Control families

One family = one kind of browser element, one switch, one token group. The ids are stable keys in settings, tokens,
console-control addresses and the API.

| Family | Browser element it replaces | Themed control | Surface |
| --- | --- | --- | --- |
| `checkbox` | `<input type="checkbox">` | framework Checkbox (box + mark, indeterminate) | inline |
| `radio` | `<input type="radio">` | framework Radio (group moves with arrow keys) | inline |
| `range` | `<input type="range">` | themed slider (track, fill, thumb, ticks, value bubble) | inline |
| `number` | `<input type="number">` | field with − / + steppers (hold to repeat) | inline |
| `datetime` | `<input type="date|time|datetime-local|month|week">` | calendar grid + hour / minute columns | popover, sheet on a phone |
| `color` | `<input type="color">` | theme swatches, recent colours, hue / saturation area, hex field | popover, sheet on a phone |
| `dialogs` | `window.alert` / `confirm` / `prompt` | framework dialog (dialog asset in force) with the same three answers | modal, sheet on a phone |
| `file` | `<input type="file">` | drop zone: browse, drag and drop, file list, per-file progress | inline |
| `tooltip` | `title` attribute tooltips | token-styled tip on hover / focus, long-press on touch | popover (never a sheet) |
| `scrollbar` | the browser's scrollbars | `scrollbar-color` / `scrollbar-width` + `::-webkit-scrollbar` rules from tokens | none (root class) |

`THEMED_FAMILIES` in the engine is this list in this order; nothing else names a family.

## Settings: one master switch, one switch per family

Plain settings keys (so a per-app or per-device choice is a setting, never code), read through `themedControlsConfig(get)`:

| Key | Value | Default | Meaning |
| --- | --- | --- | --- |
| `axf.themedControls.on` | boolean | `true` | master switch: off = every family native |
| `axf.themedControls.<family>` | boolean | `true` | that family themed while the master is on |
| `axf.themedControls.sheet` | boolean | `true` | pop-up families open as a bottom sheet below the phone cut-off; off = popover everywhere |

A family is **active** when the master is on and its own switch is on (`activeFamilies(get)` lists them in family
order). The settings are look settings only in the sense that they ride the app's own settings store; they are not
appearance tokens and never travel on the shared appearance document. The plugin's settings sub-tab (Settings →
Plugins → Themed controls) draws exactly these keys; the tooltip delay and the scrollbar width are tokens of the asset
(below), not settings.

## Native fallback

The browser's own control is the fallback at every level, and it is always still there:

- **Plugin absent or disabled**: nothing in the framework reads this contract; every element is native. The framework
  never names the plugin folder (plugin rules).
- **Family off** (master off, or its own switch off): the host leaves those elements alone. A family switched off
  while a swap is live: the themed control is removed and the original element is shown again with its current value,
  checked state and validity; nothing it holds is lost.
- **Element opt-out**: `data-axf-native` on the element, on a form or on any ancestor keeps it native whatever the
  switches say (`shouldTheme(family, attrs, config)` answers false). Elements inside `[contenteditable]` and inside
  another themed control are never swapped.
- **Form semantics stay with the original**: a swapped input is kept in the DOM, hidden (`data-axf-themed="<family>"`,
  visually hidden, still focusable by the form), and keeps its `name`, `value`, `checked`, `required`, validity and
  `form`. The themed control mirrors it both ways (user → input through the native setter + `input` / `change`
  events; script → themed through the host's observer). Form posts, `FormData`, `:invalid`, labels (`for=`) and
  `requestSubmit` work as before.
- **`window.alert` / `confirm` / `prompt`** are replaced only while `dialogs` is active and restored on off or on
  plugin unload. The async API `axf.dialogs.alert / confirm / prompt` returns Promises; the sync shim resolves the
  legacy call sites by returning the Promise, so framework and console code is moved to `await` (phase 2, s17–s18).
  A destructive confirm still needs the confirm step (console-control `confirmation_required`).
- **Scrollbars**: nothing on touch devices (overlay scrollbars are native there: `pointer: coarse` and no hover);
  on desktop the root class `fx-tc-scroll` carries the token rules and goes with the family switch.

## Phone rule: bottom sheet below the phone cut-off

The surface a family opens on comes from `surfaceFor(family, viewport, config)`:

| Family | Wide viewport | Phone (`viewport.width <= phoneMaxWidth`) |
| --- | --- | --- |
| `datetime`, `color` | `popover` anchored to the field (menu-fit@1 keeps it on screen) | `sheet` (bottom sheet, drag handle, safe-area inset) |
| `dialogs` | `modal` (the dialog asset's variant) | `sheet` |
| `tooltip` | `popover` | `popover` (a tip is never a sheet) |
| `checkbox`, `radio`, `range`, `number`, `file` | `inline` | `inline` |
| `scrollbar` | `none` | `none` |

`phoneMaxWidth` is the layout asset's cut-off (`layout-rules.mjs`, default 760 px; the root carries `data-fx-narrow`
at or under it), passed in as `viewport.phoneMaxWidth`; a host that doesn't know it passes nothing and the default
applies. `axf.themedControls.sheet = false` turns every `sheet` back into `popover` (dialogs: `modal`).

## From a native element to control props

`controlProps(family, attrs)` turns the attributes of a native element into the props of its themed control, so the
host never reads the DOM twice and every port maps the same way. `attrs` is a plain map of attribute name → string
(`null` = absent) plus `value` and `checked`; the result is one object per family:

| Family | Props |
| --- | --- |
| all | `id`, `name`, `label` (aria-label, else aria-labelledby id, else the `for=` label text passed as `labelText`, else `title`), `disabled`, `required`, `readOnly`, `invalid` (`aria-invalid` or `data-axf-invalid`), `describedBy` |
| `checkbox` | `checked`, `indeterminate`, `value` |
| `radio` | `checked`, `value`, `group` (= `name`) |
| `range` | `value`, `min` (0), `max` (100), `step` (1; `any` = 0), `list` (datalist id → ticks), `orient` |
| `number` | `value`, `min`, `max`, `step` (1), `placeholder`, `inputMode: 'decimal'` when `step` is fractional else `'numeric'` |
| `datetime` | `kind` (`date|time|datetime-local|month|week`), `value`, `min`, `max`, `step` (minutes for time kinds), `hour12` (locale, passed in) |
| `color` | `value` (`#rrggbb`, default `#000000`), `list` (datalist id → swatches), `alpha: false` |
| `file` | `accept` (list), `multiple`, `capture`, `directory` (`webkitdirectory`) |
| `tooltip` | `text` (the `title`, moved to `data-axf-tip`), `delayMs` (token), `placement` (`data-axf-tip-at`, default `top`) |
| `dialogs` | not from an element: `{ kind: alert|confirm|prompt, message, defaultValue? }` from the call |

Numbers that don't parse take the default; a `min` above `max` swaps them; `step <= 0` reads as the default.

## Tokens: the `themed-controls` asset

One optional, shared asset type `themed-controls` (themed-controls@1 data) holds **every family as a token group**;
the fields are a registry (`THEMED_CONTROL_FIELDS`, `<family>.<state>.<prop>` paths) that drives the normalizer, both
validators, the compiled tokens, the JSON schema and the control@1 target, like nav-style@1.

- **States**: `rest`, `hover`, `focus`, `active`, `checked`, `disabled`, `invalid` for `checkbox`, `radio`, `range`;
  the same without `checked` for `number`, `file` (plus `dragover`); `datetime` and `color` have the pop-up surface
  states `rest`, `hover`, `focus`, `selected`, `today` / `swatch`, `disabled`; `dialogs` has `surface`, `backdrop`,
  `title`, `message`, `field`; `tooltip` has `rest` only plus `delayMs` / `maxWidth`; `scrollbar` has `track`,
  `thumb`, `thumbHover`, `width`, `radius`.
- **Colours** are colour-theme token ids (`bg`, `surface`, `surface2`, `surface3`, `text`, `muted`, `border`,
  `accent`, `accentText`, `accentSoft`, `danger`, `success`, `warning`, `info`, `focus`), or `theme` (leave it to the
  stylesheet), **or a light|dark pair** `"<light token>|<dark token>"` picked by the colour theme's `scheme` at
  compile time, so one asset reads right on both schemes. Never a literal colour.
- **Sizes** are multiples of `--fx-space` or of the font size; radii are `theme | none | sm | md | lg | pill`; widths
  of borders are `theme | 0..4`; times are ms.
- **Compiles** to `--fx-tc-<family>-<state>-<prop>` variables (`theme` compiles to nothing, so the stylesheet rule
  applies) and the root attributes `data-fx-tc` (on / off), `data-fx-tc-families` (the active list),
  `data-fx-tc-sheet` (on / off). The plugin's stylesheet reads only these.
- **Starter `native`**: the defaults match today's look under the `soft-studio` style theme: accent-coloured mark on
  a `surface` box with a `border` border, `focus` ring, `accent-soft` hover wash, disabled at `--fx-opacity-disabled`,
  `danger` border when invalid; range track `surface3` with an `accent` fill; dialogs on `surface` under the scrim;
  tooltip `text` on `surface3`; scrollbar `muted` thumb on a transparent track. Every family's defaults are the
  stylesheet's current values written out, so switching the plugin on changes behaviour, not the look, until a skin
  or a token override says otherwise.
- **control@1**: target `tokens.controls` (asset slot `themed-controls`, key `axf.tokens.controls`) lists every field;
  `axf token controls set checkbox.checked.bg success` is the CLI form, the same path on REST / MCP / voice.

## Skin coverage

`themed-controls` is an appearance slot (not in `SKIN_NEVER`), so a skin covers it by **slot** (`assets["themed-controls"]`)
and, through the style target `themed-controls` in `schemas/customize.json` (root `.fx-tc`, items `.fx-tc__item`), by
**parts**. The registry entry declares `"skinDefault": "native"`: the generic skin upgrader (`upgradeSkin` in
`skin-rules.mjs`, `skins.mjs upgrade`) writes `assets[<type>] = <skinDefault>` into every shipped skin that doesn't name
one, so an existing skin keeps today's look and `check-skin-sections` still sees every slot shipping.

## API: every switch and every control reachable without the UI

Everything comes with an API (Brett, Nov 8 2026). Same answers on all four transports; the plugin (phase 2) wires them,
the contract fixes the names:

| What | Deep link / address | REST | MCP | CLI | Voice (AmberX) |
| --- | --- | --- | --- | --- | --- |
| The settings sub-tab | `console_show settings:plugins/themed-controls` | `GET /api/control/themed-controls/state` | `themed-controls_state` | `axf themed-controls state` | "are themed controls on" |
| Master switch | `setting:axf.themedControls.on` | `POST /api/control/themed-controls/on` / `/off` | `themed-controls_set {on}` | `axf themed-controls on|off` | "turn themed controls off" |
| One family | `setting:axf.themedControls.<family>` | `POST /api/control/themed-controls/family {family, on}` | `themed-controls_family` | `axf themed-controls family <f> on|off` | "turn themed checkboxes off" |
| Phone sheet | `setting:axf.themedControls.sheet` | `POST /api/control/themed-controls/sheet {on}` | `themed-controls_sheet` | `axf themed-controls sheet on|off` | "use bottom sheets on the phone" |
| Tokens | `tokens.controls` | `POST /api/control` target `tokens.controls` | `control_set` | `axf token controls set <path> <value>` | "make the checkbox mark green" |
| A themed control | console-control address of the element (`field:<id>`): `state`, `set`, `press` | `POST /api/console-control` | `console_set` / `console_press` | `axf console set field:<id> --value v` | "set the start date to Monday" |
| An open pop-up / dialog | `dialog:themed-controls.<family>` (`open`, `state`, `press ok|cancel`, `set`) | same | same | same | "pick the third of March", "answer OK" |

Console actions registered by the plugin: `themed-controls.toggle`, `themed-controls.family:<family>:on|off`,
`themed-controls.sheet:on|off`, `themed-controls.open:<family>:<field id>`; the deep link to the settings sub-tab is
the console_show target above. The plugin's `commands` block (plugin-commands@1) carries titles and input schemas so
REST, MCP and the CLI are derived from one list.

## Checks

- `node framework/spec/check-skin-coverage.mjs`: the type is reached by slot + parts.
- `npx -y tsx framework/spec/check-themed-controls.mts`: replays `fixtures/themed-controls.json` (config, active
  families, surfaces per viewport, control props, tokens, errors) and checks the registry entry, schema and control
  target.
- `node framework/cli/check-theme.mjs`, `check-controls.mjs`: no literal colours or sizes in the plugin's CSS, framework
  controls only.
- `node framework/cli/plugin-lifecycle.mjs check themed-controls`: removable, nothing outside its folder.
