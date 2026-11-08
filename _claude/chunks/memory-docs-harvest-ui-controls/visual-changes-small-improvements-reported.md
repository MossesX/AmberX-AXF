<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md lines=76-87 tokens=253 -->
## Visual changes (small improvements, reported)

- Install wizard (web): the field label is bold and the required `*` is red (was plain text); help text and the
  error sit under the field as before. Bool params render as a real switch instead of a native checkbox; choice
  params as choice cards instead of chips (same selection behaviour, keyboard arrow keys move within the group).
- Plugin switches: identical look (same track/thumb geometry; the framework switch reuses that CSS).
- Theme manager Show/Hide: a proper switch with "Shown"/"Hidden" text instead of a native checkbox.
- Settings → toggles and Assets in rolls: a switch instead of a native checkbox, same On/Off text.
- Components view: three new Inputs cards (Select field, Choice grid, Library parameter), two Containers cards
  (Section, Note), one Data & media card (Markdown); the Switch and Text field cards show every state.
- What's new banner / AI assistant replies: unchanged look (`.fx-md` carries the same rules the plugins had).
