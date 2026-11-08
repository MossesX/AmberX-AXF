<!-- memory-chunk@1 source=_claude/memory/docs/console-menu.md tokens=203 -->
## Known gaps

- **The default layout (`focus-top`) has `showToolbar: false`**, so View → Toolbar ticks but shows nothing until
  another layout is picked (Framework → Layouts). Pre-existing layout choice, not changed here.
- axHub has no data page to link (the "Data" entry Brett mentioned): the hub's `/projects` data is reached through
  its MCP tools only. Users / Account / Approvals open in a new tab (only the approvals and apps pages may be framed).
- Pilot pages can't be deep-linked (no URL routing in AXF apps yet): Pilot opens at its home.
- Android console: nothing (Android on hold); the Kotlin app-menu twin is a deferred gap in `framework/spec/PORTING.md`.
- The manifest's default toolbar is still `standard-icons` (CLAUDE.md says `console-search`); left as is — both are
  covered by the check.
