# Drag to tab (build `drag-to-tab`, Nov 4 2026, Opus)

## What Brett said (verbatim, Nov 4 2026, voice)

> I want to be able to drag [items] to their containers and drop them as new tabs. Like grab something from the
> navigation menu, or from one tab, drag it over to another area and drop it as a new tab.

## Result

Any nav item, in every app on the framework nav (`NavMenu` and the nav-style `NavTree`, sub-menu rows included), can
now be dragged and dropped as a new tab:

- **onto a pane's tab strip**: it opens there, at that spot (a caret shows where);
- **onto the middle of a pane**: as its last tab;
- **onto a pane's edge**: the pane splits and it opens in the new half (dock@1);
- **onto an empty dock**: it becomes the dock's first pane (*Open here*);
- **anywhere else**: it opens in a floating window under the pointer;
- **back onto the nav**: nothing happens.

If it's already open, the drop opens its **next copy** (`Console 2`, from #328), up to the host's copy cap. While a
drag is on, every strip and dock it can land in gets a dashed outline, and the zone under the pointer is filled and
labelled. **Every drop shows a toast with an Undo button**: a tab the drop opened closes again (and its floating window
with it), and a moved tab goes back. Tab moves from #328 now get the same Undo toast.

**Phone:** hold about half a second (short buzz, the row lights up), then drag. A quick swipe still scrolls, and a
hold let go in place opens the item's menu. Tested with real touch events (CDP) on a 412 × 915 viewport.

**Molly:** dragging one of its apps opens that app's own tab (its own frame). With IDE mode off, the app on screen
counts as open, so a drop opens a second copy instead of taking its frame. The copy cap is xLayout's
`maxInstances`.

## Built on

#328 (molly-multi-instance-tabs) and #327 (tab-group-assets). Both were still open, so this branch is #328's branch
with #327 merged in (conflicts in `runtime.ts`, `PORTING.md`, `RULES.md`, the baked copies, and change-log files).
Nothing from either was redone.

## Changes

- **dock@1** (`core/engines/dock.ts`): `applyDockDropNew` (a tab that isn't open yet, same zones and pane limit as
  `applyDockDrop`), `DockDropPreview.fill`. **Precedence change in `dockDropAt`:** a pane's tab strip now beats the
  host's 16 px edge band. Before, most of a 26 px strip along the top or left of the dock meant "new pane along the
  top/left", so you couldn't drop into it. Three fixture probes changed from `root top` to `header` drops.
  Trade-off: where pane strips run edge to edge along the top, a full-width top pane can't be made by dragging. Use the
  tab menu → *Move to pane ▸ Top*, or a pane body's top edge.
- **windows@1** (`core/engines/windows.ts`): `TabDrag.fresh`, `NavDragItem`, `navItemTab`, `freshTab`, `LastDrop`;
  `WindowManager.dragNew`, `dropNew`, `tabForNav`, host hooks `navTab` / `extraOpen` / `maxInstances`, `lastDrop`,
  `undoDrop`. An empty dock now takes a drop.
- **Toast action**: `Toast.action`, `rt.toast(…, { action })`; runtime action `windows.undoDrop`.
- **React**: `react/windows/dragToTab.ts` (`dragToTabDown`, `dragToTabClick`, `useDragToTab`, `toastDrop`); nav items
  in `Chrome.tsx` / `NavTree.tsx` are drag sources; `DockDropOverlay` draws the strip caret and the *Open here* fill;
  the ghost shows `+ <name>` for a new tab; `[data-fx-tab-drag]` CSS marks (tokens only).
- **Molly**: xLayout sets `navTab` / `extraOpen` / `maxInstances` (`navTabOf`, `mainAreaTabs` in `workspace.tsx`).
- **Re-baked**: console-web, Molly, axHub web and AmberX (axHub web and AmberX were stale since #327/#328; re-baking
  them brings drag-to-tab there too). All four typecheck clean.
- **Help**: 16 framework help entries written (15 from #327/#328's new controls that were below the 100% ratchet, plus
  the Undo button).
- Readme: `framework/react/windows/DRAG-TO-TAB.md`. PORTING.md: Android twin deferred.

## Tests

| Check | Before | After |
| --- | --- | --- |
| `check-dock.mts` | 1747 checks | 1815 checks, ok (fresh drops + WindowManager drag-to-tab flow: empty dock, strip index, next copy, pane edge, float, cancel, cap, host hook, undo of each) |
| `check-windows.mts` | 424 checks | 433 checks, ok (`navItemTab`, `freshTab`) |
| `check-xlayout` / `check-embed` / `check-console-commands` | ok | ok |
| tsc console-web / Molly / axHub web / AmberX | n/a | clean |
| check-theme / controls / toolbars / chrome-assets / shared-assets / help-coverage / ui-review | ok | ok |

## Screenshots

`_claude/builds/reports/drag-to-tab/shots/` (Molly, desktop 1280 × 800 and phone 412 × 915, live apps stubbed):
over the strip (caret), over a pane edge (split), dropped (new tab + Undo toast), after Undo, a split drop, and the
armed row on the phone. Sent to UI Review as non-blocking screenshots (group `drag-to-tab - Nov 4`).

## Not done

- **Dropping a tab onto the nav to pin it as a nav item** (optional): skipped. The nav's pinned items live in the
  nav-style asset (`items.pinned`), and a drop writing to it needs a settings path and its own undo. Follow-up.
- Android twin deferred (Android on hold).
