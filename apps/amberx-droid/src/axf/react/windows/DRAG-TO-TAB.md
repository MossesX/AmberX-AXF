# Drag to tab

Drag a navigation item, or a tab, onto any tab group, pane or empty space, and it opens there as a new tab.

Built Nov 4 2026 (build `drag-to-tab`). It builds on multi-instance tabs (#328) and the tab-group assets (#327).

## What you can do

| Drag | Drop on | Result |
| --- | --- | --- |
| A nav item (any app's nav menu, sub-menu rows too) | A pane's tab strip | Opens as a new tab at that spot (a caret marks it) |
| | The middle of a pane | Opens as a tab at the end of that pane |
| | A pane's edge | Splits the pane and opens in the new half (dock@1) |
| | The outer edge of a dock | A new pane along that whole side |
| | An empty dock | Opens as its first pane |
| | Anywhere else | Opens in a floating window under the pointer |
| | Back on the nav | Nothing (the drag is cancelled) |
| A tab | Any of the above | Moves there (from #328, now with the same Undo) |

If the thing is already open somewhere, the drop opens its **next copy** (`Console 2`) and doesn't move the open one.
Past the host's copy cap (Molly: xLayout → *Max copies of one app*), nothing opens and a toast says why.

While something is being dragged, every tab strip and dock it can land in gets a dashed outline. The exact zone under
the pointer is filled, with a label (*Add the tab here*, *Split right*, *Open here*…).

**Mouse / pen:** press and move a few pixels. A plain click still navigates.
**Touch:** hold (about half a second, short buzz), then drag. A quick swipe still scrolls the nav. A hold released
in place opens the item's menu.

**Undo:** every drop shows a toast with an **Undo** button. A tab the drop opened closes again (and its floating
window with it); a moved tab goes back. Also the runtime action `windows.undoDrop`.

## For app and plugin authors

Nothing to do for the framework nav (`NavMenu`, `NavTree`): its items are drag sources in every app. A drop opens the
view as a placed-view tab (`axf-placed-view`), which every `AppShell` already draws.

Make any other screen link draggable:

```tsx
import { useDragToTab } from '../axf/react';
const drag = useDragToTab({ view: 'builds', label: 'Builds', icon: 'hammer' });
<button className="fx-btn" onClick={open} {...drag}>Builds</button>
```

In a list, use the plain functions per row: `onPointerDown={(e) => dragToTabDown(rt, e, src)}` and
`onClickCapture={dragToTabClick}`. Pass `tab` in the source to open an exact tab instead of a view.

A host decides what a dragged item opens as through the window manager:

- `wm.navTab = (item) => TabSpec | null`: its own tab kind (Molly turns an app into its app tab, with its own frame).
- `wm.extraOpen = () => TabSpec[]`: things on screen outside every window (Molly's main area with IDE mode off), so a
  drop opens the next copy.
- `wm.maxInstances`: copies of one thing a drop may open (0 = no cap).

Mark an area where a drop should do nothing with `data-fx-no-drop`.

## Engine

- `core/engines/dock.ts`: `applyDockDropNew(state, tab, drop, newGroupId, windowId, rules)` drops a tab that isn't open
  yet, using the same zones and pane limit as `applyDockDrop`. Fixture `spec/fixtures/dock.json` → `fresh`.
- `core/engines/windows.ts`: `navItemTab`, `freshTab` (which copy a drop opens; fixture `windows.json` → `fresh`),
  `WindowManager.dragNew` / `dropNew` / `tabForNav` / `lastDrop` / `undoDrop`. An empty dock now takes a drop as its
  first pane (`DockDropPreview.fill`).
- `core/types.ts`: `Toast.action` (one button on a toast); `rt.toast(msg, kind, title, { action })`.
- React: `react/windows/dragToTab.ts`, the drop caret and fill label in `DockDropOverlay`, the drag marks in
  `ui/axf.css` (`[data-fx-tab-drag]`).

Checks: `npx -y tsx framework/spec/check-dock.mts`, `npx -y tsx framework/spec/check-windows.mts`.

## Not done yet

- **Dropping a tab onto the nav to pin it as a nav item** (optional in the brief) was skipped: the nav's pinned
  items come from the nav-style asset, and writing to it from a drop needs its own settings path. Logged as a follow-up.
- Android twin deferred (Android on hold): see `framework/spec/PORTING.md`.
