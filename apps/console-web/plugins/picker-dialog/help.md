# Picker dialog — help

Every drop-down in the console opens the **picker**: a themed list in a dialog on a computer, a sheet that slides up
from the bottom on a phone.

- **Choose**: tap a row. A multiple choice ticks rows; **Done** closes it.
- **Search**: long lists have a search box at the top; it matches names, descriptions and group names.
- **Keyboard**: arrows move, Enter or Space chooses, Home / End jump, typing a letter jumps to it, Escape closes.
- **Voice / API**: "open the theme picker", "choose dark", "pick the third one", "close the picker"; the same through
  REST, MCP and `picker.mjs` (see README.md → API).
- **Turn it off**: Settings → Plugins → Picker dialog → *Open drop-downs in the picker dialog*. The browser's drop-downs
  come back exactly as they were. Per app: *Keep the original drop-downs in*.
- **Looks**: the picker follows the colour theme, the style theme and the skin (`--fx-picker-*` tokens); Settings →
  Appearance → Picker chooses its starter (standard, compact list, bottom sheet, search first, plain menu, windows).
