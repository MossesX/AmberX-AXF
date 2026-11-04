# main-area-tabs: the console's main area as a tab group

Build `main-area-tabs` (Current profile, Opus, agent Snap Sully, headless). Branch `claude/main-area-tabs`.

**What Brett said (Nov 3 2026, voice):** "Which build loads the windows in a tab group in the main area?" (none yet)
"Build that now." From follow-ups.md: persistent tabs, right-click for settings, position top/left/right/bottom, drag
out to float, drop back to dock, built on the dock engine (#245). Folds in "detach anything in the main area"
(pending `plugin-floatable`).

## What changed

**Before:** the main area showed one screen at a time (`state.view`). Switching screens replaced it. Only the
Libraries page had a small "Docked comparisons" dock box.

**After:** with `AppShell mainTabs` (the console turns it on) the main area is the main window's dock, drawn with a
dedicated strip:

- Every screen opened from the nav, search, a link or a console command opens as a **tab** (icon, title, close button,
  amber dirty dot for unsaved changes via `useTabDirty(changed)`). Re-opening a screen brings its tab up.
- Tabs **persist** per device (`<app>:axf.mainTabs.session`: dock@1 snapshot, pins, closed stack) and come back on
  reload (setting "Reopen my tabs"). Tabs whose screen no longer exists (plugin removed) are dropped.
- **Reopen closed tab** (strip menu, tab menu, all-tabs list, Ctrl/Cmd+Shift+T); **overflow**: the strip scrolls
  (wheel scrolls sideways, snap), the list button opens every tab plus the last five closed.
- **Middle-click** closes; **Close others**, **Close to the right / below**; pinned tabs are kept by every bulk close.
- **Pin** (icon-only, pinned group at the front, survives reloads), **Duplicate**, **Split** right / below / left /
  above, **Float**, **Settings…** (the screen's own plugin settings tab, else Tab group settings).
- **Position**: top, bottom, left stack, right stack (setting, or right-click the strip → Tab position).
- **Float and dock**: drag a tab off the strip and let go outside the main dock: it opens as a floating window (the
  shared window layer with the resize grips from window-resize-fix). Drag a floating window's title onto any tab strip
  (highlighted while over it): its tabs dock into that group. "Dock as tabs" is on every window's title menu. Drop a
  tab on a pane edge or the dock's outer edge (dock engine drop zones) to **split** the area.
- **Settings → Tab group** (schema-built, so it gets the level toolbar): open as tabs on/off, position, size, icons,
  close buttons (always / hover / active / never), animation, open from menu = new tab or replace active, max tabs
  (oldest unpinned inactive closes first), reopen on start, swipe.
- **Phone**: side stacks become a compact top strip, close button only on the active tab, swipe the content sideways
  to move between tabs, long-press a tab to lift and drag it (a quick move scrolls the strip; holding still opens the
  tab menu).
- **Commands**: actions `tabs.open|close|float|dock|activate|pin|duplicate|split|closeOthers|closeRight|reopen|
  settings|position|size`; the console reports its tabs as `here.tabs`. MCP `tabs_list`, `tab_open`, `tab_close`,
  `tab_float`, `tab_dock`; REST `GET /api/console/tabs`, `POST /api/console/tab/<open|close|float|dock> {tab}`; CLI
  `axf console tabs`, `axf console tab open|close|float|dock <tab or screen>`.

## Contracts, engines, assets

- New `core/engines/maintabs.ts` (main-tabs@1): settings + keys, session, tab rules. Fixture
  `spec/fixtures/main-tabs.json`, check `spec/check-main-tabs.mts` (CI, android.yml spec job).
- `WindowManager`: `floatTab`, `dragGhost`, `dragCancel` (additive). Runtime: `onNavigate`, `mainTabs` API.
- `DockHost`: `DockLeafContext` lets a host draw its own pane (default unchanged).
- Tab strips carry `data-fx-tabstrip` (main and the standard tab group bar) as drop targets (`react/windows/strips.ts`).
- console-commands: `TAB_TOOLS`, `TAB_ACTIONS`, `here.tabs`, `tabs.*` are navigate-level actions.
- Styling: `framework/ui/axf.css` "main-area tab group", tokens only; the strip reuses the tab-group asset classes, so
  swapping that asset restyles it. No new asset type.
- Android twin deferred (PORTING.md).

## Compatibility

- Apps that don't pass `mainTabs` are unchanged. Brett can switch tabs off (Settings → Tab group).
- Libraries' "Docked comparisons" box is gone: redocked comparison windows now land in the main tab group.
- `plugin-floatable` s2's console half (open any page floating) is covered: every main-area screen floats. Its s1
  (`floatable` manifest field) is not built here.

## Tests

| Check | Before | After |
| --- | --- | --- |
| check-main-tabs.mts | n/a | 61 passed |
| check-dock.mts | 1679 | 1679 passed |
| check-windows.mts | 383 | 383 passed |
| console MCP tools | 51 tools | 56 tools, 139 checks |
| console-commands test.mjs | 6 | 6 passed |
| check-theme / check-controls | pass | pass |

## Known gaps

- Floating windows themselves are not saved across reloads (main-area tabs are).
- Vertical strip reorder uses the strip's own drop marker; the dock engine's header-band drop applies to top strips.
