# DRAG-MOVE — drag-move@1, one move command for everything that can be dragged

Status: contract since Nov 16 2026 (build `drag-anything-by-api-and-voice-follow-up-to-full`, Fable; follow-up to
console-control@1, CONSOLE-CONTROL.md).
Reference: `framework/core/engines/drag-move.ts` (pure: the kinds registry, the command, validation, drop-zone resolution,
the new order, the host registry, the wire envelopes, the JSON Schema). Snapshot: `framework/schemas/drag-move.json`
(`check-drag-move.mts` keeps it equal). Fixture: `framework/spec/fixtures/drag-move.json` (gen-fixtures.mts). Web seam:
`framework/react/dragHost.ts` (`useDraggableHost`, the shared pointer apply). Kotlin twin deferred (Android on hold,
PORTING.md). No new asset type: a drag host is a UI piece, not an asset; the sides of the banner and the toolbar are read
from `asset-types.json` through the widget engine's host registry.

## Why

Brett (Nov 13 2026): "I want to be able to drag anything on any page, anything that's draggable, I want to be able to drag
it." Every list on the page that a pointer can reorder (banner widgets, toolbar items, tab rows, dock panes, grid columns
and rows, list items, layout slots) does it with its own drop maths and its own apply, and none of them can be driven
without a pointer. drag-move@1 is **one command** that names the thing, where it comes from and where it lands, and
**one pure engine** that validates it and computes the new order. The UI's pointer drop and a REST / MCP / CLI / voice
call build the same command and run the same apply, so whatever a finger can drag an API can move too, and the result
reads the same on every device.

## The command

```json
{ "$axf": "drag-move@1", "op": "move", "kind": "tab",
  "source": { "container": "settings.tabs", "id": "plugins" },
  "target": { "container": "settings.tabs", "zone": "before", "ref": "appearance" },
  "by": "claude", "reason": "put Plugins next to Appearance" }
```

| Field | Meaning |
|---|---|
| `$axf` | `drag-move@1` (optional on the way in; the normalizer adds it) |
| `op` | `move` (default), `add` or `remove` (`DRAG_OPS`, append-only) |
| `kind` | a registered draggable kind (`DRAG_KINDS`, open registry, see below) |
| `source.container` | the host the item sits in now (required for `move` and `remove`; absent or a catalogue id for `add`) |
| `source.id` | the item (required). For `add`, the id the host gives the new item (a widget's `type:id` key, a column id, a slot type) |
| `source.type` | optional, for kinds whose items are typed (a banner widget's asset type) |
| `target.container` | the host the item lands in (required for `move` and `add`; never on `remove`) |
| `target.zone` | `before`, `after`, `into` or `side` (`DROP_ZONES`); default `into`, or `after` when a `ref` is given, or `side` when a `side` is given |
| `target.ref` | the item the drop is relative to (`before` / `after` only) |
| `target.side` | the named part of a sided host (banner `left / center / right`, toolbar `start / end`, dock `left / right / top / bottom`) |
| `target.index` | position inside the container (or the side): 0 = first, the length = last; anything else is `out_of_range` |
| `confirm` | `true` to run a remove on a kind whose remove is destructive (`confirmRemove`); otherwise `confirmation_required` |
| `by`, `reason` | who asks and why, echoed in the result and the activity log; never affect the outcome |

Rules (`normalizeDragMove` enforces them, `dragMoveErrors` lists every problem):

- `op`, `kind` and `source.id` are always required. Ids are 1 to 160 characters, matched case-insensitively against the
  host's snapshot, echoed in the host's spelling.
- `move`: `source.container` and `target.container` required. The same container is a reorder; a different one is a
  cross-container move (the kind's `crossContainer` must be true, else `not_allowed`).
- `add`: the kind's `add` must be true; `target.container` required; the item must not already be in the target
  (`duplicate`). `source.container` may name where it comes from (a catalogue, a palette) and is echoed only.
- `remove`: the kind's `remove` must be true; `target` must be absent (`invalid`); a `locked` item answers `not_allowed`.
- `zone`: `before` / `after` need `ref` and take no `index`; `into` takes `index` or lands last and takes no `ref`;
  `side` needs `side`: a sided host names its own sides, a flat host of a kind with fixed sides (`dock-pane`) takes the
  kind's (`invalid_zone` when neither has sides, the side is unknown or the kind does not offer the zone). `side` takes an
  optional `ref` (the item it lands next to, right after it; for a dock pane the pane to split) or an `index`; the plan's
  `to` carries `side` and `ref` so the host knows what to split.
- Indices are counted on the list **after** the source has left it (same-container moves), so `index: 0` always means
  first and `length` always means last. `before ref` is `ref`'s index on that list, `after ref` is one more.
- A `max` on the host: a cross-container move or an add into a host that is full answers `limit`.
- A move that leaves every touched container in the same order answers `no_change` (the UI treats it as a drop in place).

## Kinds

An open registry (`registerDragKind`, `dragKind`, `dragKinds`). The framework ships eight (`DRAG_KINDS`, append-only);
a library or plugin registers more without a kernel change. Each kind says what its container and item ids name, the
zones it offers, whether it has fixed sides, and whether add / remove / cross-container moves are allowed.

| Kind | Container id | Item id | Zones | Sides | add | remove | cross |
|---|---|---|---|---|---|---|---|
| `banner-widget` | the banner asset id | the attachment key `type:id` | before, after, into, side | banner `attach.sides` (left, center, right) | yes | yes | yes (banner → banner) |
| `toolbar-item` | the toolbar id | the item / widget key | before, after, into, side | toolbar `widgets.sides` (start, end) | yes | yes | yes |
| `tab` | the TabGroup settings id (the `tab:<row>` address) | the tab value | before, after, into | none | no | no | yes (dock tab rows) |
| `dock-pane` | the dock host (window) id | the pane (group) id | into (join as a tab), side (split) | dock sides (left, right, top, bottom) | no | yes (close) | no |
| `grid-column` | the grid id | the column id | before, after, into | none | yes (show) | yes (hide) | no |
| `grid-row` | the grid id | the row id | before, after, into | none | no | no | no |
| `list-item` | the list id | the item id | before, after, into | none | yes | yes | yes |
| `layout-slot` | the layout region (top, left, right, bottom, main) | the slot type | before, after, into, side | none | yes (show) | yes (hide) | yes (region → region) |

Container ids are the same ids console-control@1 already uses for the piece (`tab:settings.tabs` → `settings.tabs`,
`grid:queue` → `queue`), so a voice command that found the row with `console_control_search` can move inside it with
the same id. The registry's `confirmRemove` marks kinds whose remove loses something (`dock-pane`: the pane's tabs close).

## What a host reports

A host is one container of one kind. It registers with the runtime (`rt.drag.hosts`, below) and answers two calls:
`list()` → a snapshot, and `apply(plan)` → it writes the new order. The engine never touches the DOM.

```ts
interface DragHostSnapshot {
  kind: string; container: string; label?: string;
  sides?: string[];                        // a sided host; every item carries its side
  items: { id: string; side?: string; type?: string; label?: string; locked?: boolean }[];   // in order (per side)
  accepts?: { add?: boolean; remove?: boolean; from?: string[] | '*' };                     // tighter than the kind, never looser
  max?: number | null;                     // most items it holds (null = no limit)
}
```

## What the engine returns

`planDragMove(cmd, snapshots)` → a plan, or throws `DragMoveError` with a code:

```ts
interface DragPlan {
  $axf: 'drag-move-plan@1'; op; kind; item: { id; type? };
  from: { container; side?; index } | null;            // null on add
  to:   { container; side?; index } | null;            // null on remove
  order: Record<string, string[] | Record<string, string[]>>;   // every touched container's new order (per side when sided)
}
```

The order is the whole container, not a delta, so a host applies it with one write and a port replays it with one
compare. `applyOrder(snapshot, order, arriving?)` gives the host's item list in the new order for a host that keeps
objects: an id it does not hold is an arrival (kept as `arriving` or a bare `{ id }`), an id left out is gone.

Codes (`DRAG_MOVE_CODES`, append-only): `invalid`, `unknown_kind`, `unknown_container`, `unknown_item`, `unknown_ref`,
`invalid_zone`, `out_of_range`, `not_allowed`, `duplicate`, `limit`, `no_change`, `confirmation_required`, `failed`.

Envelopes: `dragMoveResult(cmd, plan)` → `{ $axf: 'drag-move-result@1', ok: true, op, kind, item, from, to, order, by }`;
`dragMoveFailure(cmd, err)` → `{ $axf: 'drag-move-result@1', ok: false, code, message, nearest? }` where `nearest`
names the containers of that kind the registry knows when the container or item was not found, so a caller never has to
guess an id.

## Pointer drops

The same maths the pointer uses: `pointerZone(rect, px, py, vertical)` → `before` when the pointer is in the first half
of the item it is over, else `after`; `pointerDrop(kind, container, overId, rect, px, py, vertical)` builds the target
for the command. A UI drop is `planDragMove` on that command, then the host's `apply`, exactly what the API runs.

## Hosts at run time (`rt.drag.hosts`)

`DragHostRegistry` (engine, pure): `register(host) → off`, `snapshot(kind, container)`, `snapshots(kind?)`,
`run(cmd) → Promise<DragMoveResult>` (normalize → plan → the touched hosts' `apply`, in order; a throwing `apply` answers
`failed`). The React hook `useDraggableHost(kind, containerId, { list, apply })` registers on mount, drops on unmount,
and re-registers when the container id changes. The runtime registers the action `drag-move:<json>` on its ActionBus,
so the transports that already carry console actions (console.actions run, console_action, `axf console action`,
AmberX) move things today; the follow-up phase adds the dedicated `console_drag_move` MCP tool, the REST verb and the
CLI `axf console move`.

Hosts registered today (this build's s4): every `TabGroup` with an `onReorder` (kind `tab`, container = the row id,
`accepts.from: []` so a tab never lands in another row unless that row says so), and the banner and the app toolbar
through `useArrange` (kinds `banner-widget` / `toolbar-item`, container `banner` / `toolbar`, `accepts.add / remove:
false` until the widgets phase wires add and remove). Their pointer drops run the same command through `runDragMove`.
Dock panes, grids, lists and layout slots register in the follow-up phases.

## Fixture

`framework/spec/fixtures/drag-move.json`: the registry (kinds, ops, zones, codes), the JSON Schema, and cases for a
reorder (before / after / into / index), a cross-container move, a sided move, an add, a remove, a locked item, every
invalid zone, an out-of-range index, a full host, a duplicate add, a no-change drop, the pointer zone probes and the
result envelopes. A port replays every case and must produce the same plan or the same code.
