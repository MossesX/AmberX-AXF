<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal-fable.md tokens=178 -->
## Contracts and fixtures

| Contract | Change | Fixture |
|---|---|---|
| windows@1 | additive fields on `WindowSpec` (`frame`, `maximized`, `restore`, `minWidth`, `minHeight`), new pure functions and manager methods, `WindowState.preview` | `windows.json` new: resize, maximize, snap, zones, split, workspace sections — `check-windows.mts` 383 checks |
| settings-ui@1 | level ids renamed (`pro` → `administrator`, `advanced` → `developer`), additive `visible` field + saved setting `axf.settings.visible`; Administrator shows all | `settings-ui.json` 31 → 43 checks |

Wire and asset formats stay readable by the old engines: unknown fields are ignored, and the old level ids are still
accepted on the way in.
