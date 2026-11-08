<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal-fable.md lines=16-62 tokens=1033 -->
## Differences

**Removed**
- The host title bar, window toolbar and tab-group bar above the Terminal: a `frameless` window shows only the content's
  own bar (the Terminal strip, with caption buttons). s23 also hides the host's tab-group bar for a single-tab frameless
  window (it came back as a second title bar in the first s23 shots); a second tab dropped in brings the bar back.
- lib-workspace's own floating-pane clamp, `WindowResizeHandles` copy and CSS `resize` (s19): panes run on the window
  engine's geometry.
- Settings level names **Pro** and **Advanced** (migrated, see below).

**Kept**
- Every Opus-phase Terminal feature (tab strip, ∨ menu, command toolbar, Windows keys, connections, profiles, settings).
- Standard-frame windows (every other floating window): same title bar, now with resize handles and a maximize button.
- Window menu, minimize to corner / floating toolbar, redock, grid / tree mode, window settings dialog.
- Settings interfaces: tabs, search, groups, Restore look; the level toolbar is additive and hideable (`axf.settings.levelbar`).

**Changed**
- `WindowSpec` gains `frame`, `maximized`, `restore`, `minWidth`, `minHeight`; `openFloating(..., opts)`.
- Drag physics: the engine snaps from the unsnapped pointer position each step (no accumulated pull); a maximized window
  restores under the pointer when dragged; **windows may leave the screen** (no viewport clamp, Brett Oct 28).
- Settings levels: `SETTINGS_LEVELS = simple | basic | developer | administrator`; Administrator shows everything;
  settings outside the picked level sit in a second collapsible container ("More settings") instead of disappearing.
- Double-tap / double-click a title bar = maximize / restore (Windows).

**Added**
- Window engine (`framework/core/engines/windows.ts`): `RESIZE_EDGES` (8), `hitResizeEdge`, `resizeCursor`, `resizeRect`,
  `maximizedRect` / `maximizeWindow` / `restoreWindow` / `toggleMaximized` / `dragRestore`; snapping `SnapRules`,
  `snapRect` (screen + window edges), `SNAP_ZONES` / `snapZoneAt` / `snapZoneRect` (half / quarter, top = maximize),
  `resolveOverlap`, `splitDrop` / `topmostAt` / `armSplit` (drop onto a window after a dwell → split), `WindowState.preview`;
  manager `resizeFrom`, `setMinSize`, `setFrame`, `maximize` / `unmaximize` / `toggleMaximize`, `dragTo` / `settle` /
  `snapTo` / `splitOnto` / `setSnapRules`, `workArea`; actions `windows.maximize`, `windows.snap`; window menu Snap submenu.
- React (`WindowHost.tsx`): 8 pointer + touch resize handles (frameless content gets them too), maximize / restore
  button, `useWindowFrame()` hooks for frameless content, `SnapPreview` layer (tokens + `--fx-opacity-tint`).
- Terminal: frameless window; the strip drags, right-clicks as the title bar and carries minimize / maximize / close.
- lib-workspace: `dragFloatTo` / `settleFloat` / `resizeFloatFrom` / `maximizeFloat` / `restoreFloat` / `minimizeFloat` /
  `snapFloatTo`, `FloatRect.maximized` / `restore` / `minimized`, `FLOAT_MIN`.
- settings-ui@1: `SETTINGS_LEVEL_MIGRATION`, `settingsLevelOf`, per-level visible sets (`visible: { <level>: { show, hide } }`),
  `normalizeSettingsVisible`, `mergeSettingsVisible`, `withSettingsVisible`, `setSettingsVisible`, `settingsItemLevel`,
  `settingsVisibleAt`, `shownAtLevel`, `settingShownAtLevel`, `splitSettingsGroup`.
- lib-settings: level toolbar on every settings interface (Segmented picker, hint, Edit levels, ⋯ menu with Hide; context
  target `settings-levelbar`; actions `settings.level`, `settings.levelbar`), **Settings levels** dialog (`levels.tsx`):
  left a sorted, categorised tree of every setting (coloured by on / off at the level, multi-select, Add to visible /
  Remove buttons and right-click), right the tree of what is on; the settings page updates live.
- Fixtures `spec/fixtures/windows.json` (new) and `settings-ui.json` (cases `visible*`, `level`, `shown`, `split`,
  `set-visible`), `spec/check-windows.mts` (new), `check-settings-ui.mts` extended, CI steps.
- s23: `rebake.mjs` also bakes `libs/` when an app ships `src/axf/libs` (as CI does), so status / apply match the lock.
