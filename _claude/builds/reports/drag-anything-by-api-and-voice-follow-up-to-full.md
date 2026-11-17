# Drag anything by API and voice

Build `drag-anything-by-api-and-voice-follow-up-to-full` (follow-up to full API control, PR #556). Phase 1 on Fable
(s1–s4: contract, engine, fixture, runtime seam), phase 2 on Opus (s5–s21, this report).

Brett, Nov 13 2026: "I want to be able to drag anything on any page, anything that's draggable, I want to be able to
drag it. The regular API build land first."

## What it does

Every draggable thing has one move command, drag-move@1 (`framework/spec/DRAG-MOVE.md`). It names what moves (kind,
container, item) and where it lands (container, `before` / `after` an item, `into` at an index, or a `side`), plus
`add` and `remove`. The engine (`framework/core/engines/drag-move.ts`) checks the command and works out the new order.
Each host registers on `rt.drag.hosts` with `list()` and `apply(plan)`. Its own pointer drop now sends the same
command, so an API move and a drag end up identical. That is checked per host kind in `check-drag-hosts.mts`.

## How each draggable is reached

All of them answer to the same five ways in:

- **Deep link:** `drag:<kind>:<container>[:<item>]` in `console_show` / `console_open`, `GET /api/drag/show`,
  `axf drag show` and the `drag.show` action. It opens the page, highlights the item and its drop zones, and answers
  the host's current order.
- **REST:** `GET /api/drag/hosts|zones|show`, `POST /api/drag/move|add|remove|preview|voice`.
- **MCP:** `console_drag_list`, `console_drag_zones` (read-only), `console_drag_move|add|remove` (veto, `reason` required).
- **CLI:** `axf drag list|zones|show|move|add|remove|preview|voice`.
- **Voice:** console voice, `/api/console-control/voice`, `console_control_voice` (AmberX) and `/api/drag/voice`.

| Draggable | Kind | Container id | Move | Add / remove | Pointer path now |
|---|---|---|---|---|---|
| Banner widgets | `banner-widget` | `banner` (items `type:id`) | reorder, to another banner side | show / hide through the banner widget engine | Arrange drop and arrow keys send the command |
| App toolbar widgets | `toolbar-item` | `toolbar` | reorder, start ↔ end | – (no hide choice for toolbar widgets yet) | same as the banner |
| Workspace toolbars (lib-workspace) | `toolbar-item` | `<workspace>.<toolbar>` | reorder, to another toolbar | a command (its spec is the id; repeats `spec~2`), remove | customizer drops and buttons send the command |
| Terminal session strip | `tab` | `terminal.<window tab>` | reorder, to another Terminal window | – | strip reorder sends the command |
| Workspace pane strips | `tab` | `workspace.<id>.<area>` | reorder, to another area (`Workspace.placePane`) | – | a drop on an area sends the command |
| Window tab stacks | `tab` | the group id | reorder, to another stack | – | the pointer and the API both call `WindowManager.dropTab` |
| Dock panes | `dock-pane` | the window id | `side` + `ref` splits that pane, `side` alone splits the tree, `into` joins a stack | remove closes the pane's tabs (confirm) | `dropTab` → `applyDockDrop` |
| DataGrid columns (every grid) | `grid-column` | the grid id | reorder (new: order per device, `axf.grid.columns.<id>`, or the host's `columnOrder`) | show / hide where the grid has a column menu | – (no column drag before) |
| DataGrid rows | `grid-row` | the grid id | where the grid takes `onMove`; locked while sorted | – | a row dropped on a row sends the command |
| Build manager queue | `list-item` | `build-manager.queue` | reorder | – | drop and arrow buttons send the command |
| Merge queue | `list-item` | `merge-queue` (items = PR numbers) | reorder (the queue's own move) | – | drop sends the command |
| Plan Studio board | `list-item` | `plan-studio.<status>` | to another column (sets the status) | – | drop sends the command |
| AI keys accounts | `list-item` | `ai-keys.accounts` | reorder (saves the order) | – | handle drag unchanged, same save |
| Layout regions | `layout-slot` | the region | – (the layout asset's `data.slots` decides; answers `failed` with that hint) | show / hide the slot | View menu |
| Any other sortable list | `list-item` | its own | `useSortableListHost(listId, …)` in one call | when it says so | – |

## Files

- Framework: `core/engines/drag-hosts.ts` (pure adapters: widget hosts, window stacks / dock panes, layout regions,
  grid helpers, id helpers, locators), `core/engines/drag-voice.mjs` (+ `.d.mts`), `react/dragHost.ts` (hooks:
  `useDraggableHost`, `useDraggableHostSet`, `useSortableListHost`), `react/components/DragPreview.tsx` (drop-zone overlay,
  mounted by AxfProvider), `ui/axf.css` (drag preview section, tokens only), Arrange, Banner, TabGroup, DataGrid,
  lib-workspace (store `placePane`), `cli/drag.mjs`, `cli/axf.mjs`.
- Console: `src/actions/drag.ts` (executor, actions, voice, deep link, preview), `src/control/index.ts`,
  `src/actions/voice-control.ts`, console-commands relay (`control` op carries `drag.*`), Build manager, push-banner
  queue, Plan Studio, AI keys, Terminal host.
- Server: `drag_move.py` (validator, the engine's twin), `drag_api.py` (routes, `command()`, deep link parser),
  `main.py`, `console_control_api.py` (voice hand-off), `mcp_server.py` (tools, `drag:` links).
- Tests: `framework/spec/check-drag-hosts.mts` (315 checks, CI), `server/tests/test_drag.py` (CI),
  `scripts/drag-smoke.mjs` (Playwright, 18 checks; run through agent-slots heavy, not in CI, like the other e2e scripts).
- Docs: glossary terms `drag-move`, `drag-commands`, `drag-mcp`, `drag-link`; console help for every drag action and
  "Drag anything"; catalog `cx.drag` (built); tracker regenerated; DRAG-MOVE.md host table.

## Checks run (all pass)

`axf validate apps/console-web` (565 assets), `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`,
`check-console-control`, `tracker --check`, `check-drag-move.mts` (569), `check-drag-hosts.mts` (315), `check-dock.mts`
(1679), `test_drag.py` (6), `test_console_control.py` (8), `test_mcp_tools.py` (222), console typecheck against the
current framework (CI-style bake), `drag-smoke.mjs` on a fresh build (18). The baked `src/axf` copy is not
committed: CI rebakes it from `framework/`.

## Decisions

- **Relay:** drag requests ride the existing console-commands relay (`control` op, `drag.*` verb). That meant no new
  channel and no change to console-control@1.
- **Order of voice intents:** console-control's own intents run first, and drag takes the phrases they leave.
  "show step 3 of …" keeps its old meaning; "show" counts as an add only with a named kind ("show the CPU widget").
- **Pure adapters in core:** they live in `core/engines/drag-hosts.ts`, so the check runs without React and a port
  can mirror them. DataGrid's apply maths is `nextColumnOrder` / `rowDropOf` there.
- **Banner preview:** the Widgets picker's banner preview no longer registers as a host. Before, closing the picker
  dropped the live banner host.

## Left over

- **Engine gap (Fable):** `planDragMove` answers `no_change` for a dock-pane `side` move that keeps the reading order
  (e.g. splitting the second pane to the bottom of the first). The tree shape changes there, so that move should run.
  Fixing it is an engine and fixture change (contract), so it was not done on Opus. The test uses a split that
  changes the order.
- **Layout slot moves:** moving a slot type between regions means editing the layout asset; the command answers
  `failed` and says so.
- **Toolbar widget add / remove:** the app toolbar has no hide choice like the banner's; toolbar widgets only move.
- **TabGroup rows:** no TabGroup row in the console takes `onReorder` today. Rows that do are hosts, but they only
  reorder inside themselves (`accepts.from: []`). Cross-row moves are the window tab stacks'.
- **Window tab stacks are per session** (the window layout isn't persisted), so a tab move doesn't survive a reload.
  The smoke's tab leg runs only when a tab host is on screen and reports otherwise.
- **Not registered as hosts yet:** `src/views/Plan.tsx` kanban, the builds-page proposals (its grids are covered by
  DataGrid), HomeCards, Explorer and Plugin commands card drops (drag-to-create, not reorder), md-studio snippets
  (drag-to-insert), glossary-index book chapters (lib-dnd), the context-menu designer, lib-tree, lib-ashes,
  BannerGroup, WatchLive.
- **Hand-drawn Terminal strip:** it still lacks `data-axf-tab-group` (a chrome-baseline finding from before this
  build); it is a drag host now.
- **Kotlin twin:** deferred (PORTING.md).
