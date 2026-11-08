<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal.md lines=57-63 tokens=115 -->
## Known gaps (→ Fable phase / later)
- The window engine still draws its own title bar, window toolbar and tab-group bar above the host's strip: the
  frameless window with the tab strip in the title bar is s6 (window engine). Minimize / maximize / snap / edge resize
  come from s6–s8.
- Tab drag between windows: use *Move to a new window* for now.
- In this sandbox the shells don't connect (no WebSocket through the shot harness, same before and after).
