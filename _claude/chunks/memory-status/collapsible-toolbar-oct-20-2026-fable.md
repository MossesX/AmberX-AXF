<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=53-53 tokens=135 -->
## Status (as of Oct 21 2026)

- **Collapsible toolbar (Oct 20 2026, Fable):** toolbar asset field `collapsible: boolean` (default false): a chevron at the end folds the toolbar to a thin handle and back, remembered per device (`rt.toolbarCollapsed()` / `setToolbarCollapsed()`; web setting `axf.toolbar.collapsed`, Kotlin `<key>:toolbar-collapsed`). Engine attr `data-fx-toolbar-collapsible` (`components.ts` = `ComponentStyleEngine.ToolbarStyle.collapsible`, fixture case `toolbar-collapsible`); React `Toolbar` + Compose `AxfToolbar`.
