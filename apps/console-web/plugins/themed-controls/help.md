# Themed controls

Brett (Nov 14 2026): "replace other browser elements like the dropdowns with themed ones". This plugin swaps the
controls and dialogs the browser draws itself for ones drawn from the theme's tokens (themed-controls@1,
`framework/spec/THEMED-CONTROLS.md`). Drop-downs are the picker dialog's job; this plugin does everything else.

## Where

Settings → Plugins → **Themed controls**: a master switch, *Bottom sheet on a phone*, one switch per family, and the
*Tooltips and scrollbars* sliders. Off (or the plugin removed) = every control is the browser's own again, with the
value it held. Add `data-axf-native` to an element, a form or any container to keep it native.

## Families

| Family | Replaces | Keyboard |
| --- | --- | --- |
| Checkboxes | `input[type=checkbox]` | Space |
| Radio buttons | `input[type=radio]` | arrows, Home, End |
| Range sliders | `input[type=range]` | arrows, Page Up / Down, Home, End |
| Number fields | `input[type=number]` | arrows, Page Up / Down, Home, End; hold − / + |
| Date and time pickers | `date`, `time`, `datetime-local`, `month`, `week` | Alt+↓ opens; arrows, Page Up / Down, Enter |
| Colour picker | `input[type=color]` | arrows in the area and hue strip, Enter = Done, Escape = Cancel |
| Alert, confirm, prompt | `window.alert / confirm / prompt` | Enter = OK, Escape = Cancel |
| File drop zone | `input[type=file]` | Enter / Space browses |
| Tooltips | `title` attributes | focus shows, Escape hides; long-press on touch |
| Scrollbars | browser scrollbars (desktop) | — |

Pickers and dialogs open as a popover (dialogs: centred) on a wide screen and as a bottom sheet on a phone.

## For code

- `import { dialogs } from '@console/axf/react'` → `await dialogs.confirm('Delete it?')`, `await dialogs.prompt('Name', 'untitled')`,
  `await dialogs.alert('Saved')`. Themed while the family is on, the browser's otherwise. `window.alert` is themed too;
  `window.confirm` / `window.prompt` need a synchronous answer, so they stay the browser's (the console logs the call site).
- Upload progress in a drop zone: `input.dispatchEvent(new CustomEvent('axf:file-progress', { detail: { name, loaded, total } }))`;
  a cancel from the API arrives as `axf:file-cancel` with `{ name }`.

## API (the same on every transport)

| What | Console (deep link / address) | REST `/api/plugins/themed-controls/…` | MCP | CLI | Voice |
| --- | --- | --- | --- | --- | --- |
| Settings tab | `console_show settings:plugins/themed-controls`, action `themed-controls.open` | `GET state` | `themed-controls_state` | `axf themed-controls state` | "open the themed controls settings" |
| Master switch | `setting:axf.themedControls.on`, `themed-controls.toggle:on|off` | `POST on`, `POST off` | `themed-controls_on/_off` | `… on|off` | "turn themed controls off" |
| One family | `setting:axf.themedControls.<family>`, `themed-controls.family:<f>:on|off` | `POST family {family, on}` | `themed-controls_family` | `… family checkbox off` | "turn themed checkboxes off" |
| Phone sheet | `setting:axf.themedControls.sheet` | `POST sheet {on}` | `themed-controls_sheet` | `… sheet on` | "turn bottom sheet on a phone off" |
| A control | `setting:field.<id or name>` (state, set, focus), `themed-controls.set:<ref>:<value>` | `GET controls`, `POST set {ref, value}` | `themed-controls_controls`, `_set` | `… set start 2026-03-03` | "set the start date to 2026-03-03" |
| Date / time / colour picker | `panel:themed-controls.datetime|color` (open, state, set, press ok|cancel), `themed-controls.open:<ref>` / `.close` / `.pick:<value>` | `GET pickers`, `POST open {ref}`, `close`, `pick {value}` | `_pickers`, `_open`, `_close`, `_pick` | `… open start`, `… pick 2026-03-03` | "open the start date picker" |
| Colours | same, plus recent colours | `GET colors` | `_colors` | `… color accent-field red` | "make the colour field red" |
| Dialogs | `panel:themed-controls.dialogs`, `button:themed-controls.dialog.ok|cancel` (OK on a destructive confirm needs `confirm`) | `GET dialogs`, `POST answer {answer, text?, confirm?}` | `_dialogs`, `_answer` | `… answer ok`, `… answer cancel` | "answer OK" |
| Files | `setting:field.<ref>` set `clear` / `cancel[:name]` | `GET files`, `POST files {ref, action}` | `_files`, `_files-action` | `… files upload clear` | "clear the upload field" |
| Tooltip / scrollbar | `setting:themed-controls.tooltip.delayMs`, `…scrollbar.width`, `themed-controls.token:<path>:<v>` | `GET tokens`, `POST tooltip {delayMs}`, `POST scrollbar {width}` | `_tokens`, `_tooltip`, `_scrollbar` | `… tooltip 300`, `… scrollbar 8`, `axf token controls set tooltip.delayMs 300` | "set the tooltip delay to 300" |
| Every colour / size | control@1 `tokens.controls` | `POST /api/control` | `control_set` | `axf token controls set checkbox.checked.bg success` | "make the checkbox mark green" |

`node apps/console-web/plugins/themed-controls/cli.mjs <short form>` maps the positional forms above onto
`axf themed-controls <command> --field value`.
