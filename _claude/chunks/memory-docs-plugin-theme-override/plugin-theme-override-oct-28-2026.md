<!-- memory-chunk@1 source=_claude/memory/docs/plugin-theme-override.md tokens=176 -->
# Plugin theme override (Oct 28 2026)

Brett (Oct 28 2026): every plugin UI, not only floating ones, gets a theme override over the axHub theme: a collapsible
container in the plugin's Appearance tab with every layout / colour / style / animation token, several editing views,
switchable from right-click, the toolbar and the application menu.

Built on **Opus** as refactor-all s72–s75 (group `plugin-theme-override`), branch `refactor-all/plugin-theme`. Brett
**skipped** the Fable steps (refactor-all s68–s70: plugin-theme@1 contract, scoped engine + fixture, React layer), so
this is a web library on what already exists, not a cross-port contract. Android: deferred (`framework/spec/PORTING.md`).
