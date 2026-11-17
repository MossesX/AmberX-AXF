# Live changes — `live-change@1`

**Rule (Brett, Nov 17 2026):** "Why don't I get a hot refresh every time shit changes in the grid? Anytime something
changes, like a drag and drop or something, it has to hot render." Every grid and list on the framework re-renders the
rows that changed the moment they change, wherever the change came from (this screen, another console, the CLI, MCP,
voice, the orchestrator, the hub). No reload, no poll-and-replace, no lost scroll position.

`live-change@1` is the one event every row store emits and every grid consumes. The reference engine is
`framework/core/engines/live-rows.ts` (pure TypeScript, no React); the web grid (`framework/libs/datagrid`) and the
console's row stores sit on it. Fixtures: `spec/fixtures/live-rows.json` (from `gen-fixtures.mts`); checker
`spec/check-live-rows.mts`. Registry snapshot: `framework/schemas/live-change.json`; JSON Schemas
`schemas/json/live-change.schema.json`, `live-change-batch.schema.json`. Kotlin twin deferred (Android on hold,
`PORTING.md`).

## Model

- A **row set** is one keyed, ordered list of rows that a grid or list shows: the builds grid, the steps of one build,
  the planner items, a plugin's rows. It is addressed by a **namespace** (`ns`). Every row has a **key** (`key`),
  unique inside its namespace, stable for the row's life.
- Every change to a row set is one **change event**. Events in a namespace carry a **rev** that counts 1, 2, 3… with
  no gaps and no reuse. The rev is the whole protocol: a consumer that holds rev `R` and sees `R + 1` applies it; one
  that sees `R + 2` or more missed something and **resyncs**; one that sees `≤ R` already has it and skips it.
- A change carries its **origin** (which session on which surface made it, and the client op id when it answers a
  local optimistic op) so a grid can tell its own echo from everyone else's change, and the console can show who did
  what.
- A grid applies a batch of events and gets back **only the keys that changed**. It re-renders those rows and nothing
  else: scroll, selection, sort, filters, expanded rows, column picks and every open dialog stay as they are.

The same event shape works for every store: the builds store (`builds@1`), the planner, UI Review, notes, plugin
data folders. A store that already emits `data-change@1` (`data-store@1`, `watch`) maps it 1:1: `ns` → `ns`,
`path` → `key`, `put` → `upsert`, `delete` → `delete`, `rev` → `rev`, `by` → `origin`, `at` → `ts`; an ordered store
adds `reorder`.

## Event

```jsonc
{
  "$axf": "live-change@1",
  "ns": "builds",                 // the row set: a data-store@1 namespace, optionally /<path> for a sub-set (builds/<id>/steps)
  "key": "live-hot-refresh",      // the row's key inside ns
  "op": "upsert",                 // upsert | delete | reorder
  "rev": 1842,                    // per-namespace, contiguous, never reused
  "row": { … },                   // upsert only: the WHOLE row as it now is (never a patch)
  "before": "other-key",          // reorder only: the key the row now sits before; null = the end of the set
  "origin": {
    "session": "s-9f31",          // the session (Claude session, browser tab, CLI run, hub worker) that made it
    "surface": "console",         // console | cli | mcp | voice | api | orchestrator | hub | plugin | server (open set)
    "client": "c-7a2e",           // optional: the client instance that sent it (a browser tab); its own echo
    "opId": "op-0c1d"             // optional: the client op id of the optimistic op this confirms (optimistic@1)
  },
  "ts": 1763392341233             // when the store took it (ms since epoch)
}
```

| Field | Rule |
| --- | --- |
| `ns` | `^[a-z0-9_-]+(/[A-Za-z0-9._:-]+)*$`, at most 160 chars. The first segment is a `data-store@1` namespace (`builds`, `planner`, `plugins`, …); the rest names the row set inside it. |
| `key` | 1–128 chars, no `/`, unique in `ns`, never reused for another row. |
| `op` | `upsert` — the row is inserted (unknown key, appended at the end of the order) or replaced (known key, same place). `delete` — the row is gone. `reorder` — the row moved: it now sits before `before` (null = last). |
| `rev` | integer ≥ 1. Contiguous per `ns`. An event's rev is the namespace's rev after the change. |
| `row` | required with `upsert`, absent otherwise. Always the whole row: the consumer replaces, never merges. |
| `before` | with `reorder` only; a key in the set or `null`. |
| `origin.session` | required, 1–64 chars. |
| `origin.surface` | required; the listed surfaces plus any new one (open set, lower-case). |
| `origin.client` | optional; the sending client instance. An event whose `client` is the consumer's own is its own echo. |
| `origin.opId` | optional; the optimistic op this change confirms (see Optimistic below). |
| `ts` | integer ms. Informational; ordering is by `rev`, never by `ts`. |

Unknown fields are kept and ignored (open frame). `$axf` is required on the wire and may be dropped in memory.

### Batch

A store sends events in batches (`live-change-batch@1`): `{ "$axf": "live-change-batch@1", "ns", "events": [...],
"rev" }` where `events` are in rev order and `rev` is the namespace's rev after the last one (equal to the last
event's rev; with no events it is the current rev, so a consumer can check it is still current). A batch answers one
`since` query (below) or is pushed on a watch.

## Resume from rev

A consumer never asks for "everything"; it asks for **what happened after the rev it holds**.

- `since(ns, rev)` → either a batch whose first event is `rev + 1` and whose events are contiguous, or a **resync**
  answer `{ "$axf": "live-change-resync@1", "ns", "reason", "rev", "rows": [...], "order": [...] }`: the whole row
  set at `rev`, in order. The consumer replaces its set and carries on from that rev.
- Reasons the store answers with a resync instead of events: `history` (it no longer holds events back to `rev`:
  the log is bounded, newest kept), `epoch` (the store restarted with a new rev line; the set carries an optional
  `epoch` string, a different one means every rev is void), `behind` (the consumer's rev is ahead of the store's:
  the store lost state and the consumer must take the store's truth).
- Reasons a **consumer** decides it needs a resync itself (`applyLiveChanges` returns `resync`): `gap` (an event's
  rev is more than one past the rev it holds), `epoch` (an event carries a different epoch). On `resync` the
  consumer applies **none** of the batch, keeps its rows and its rev, and asks `since` again; the store answers with
  the resync frame. Nothing is ever applied out of order and a half-applied batch never exists.
- Events with `rev ≤` the held rev are duplicates (a reconnect replayed them): skipped, not an error.
- A fresh consumer starts with `rev 0` and a `since(ns, 0)`; the store answers with a resync (`history` or the
  whole set) and the consumer takes it. The first paint and every later one go through the same engine.

Transports carry the same frames: the console's SSE `/api/live/changes?ns=…&since=…`, `data-store@1 watch`, an
MCP `live_changes` read, the CLI `axf live since <ns> <rev>`, AmberX voice ("what changed in the builds grid"): one
contract, four ways in (API rule, Brett, Nov 8 2026).

## What a grid keeps

The engine returns the keys that changed; the grid touches only those rows. Everything that belongs to the viewer
stays as it was across every batch and every resync (`KEEP_ON_CHANGE`):

| Kept | Rule |
| --- | --- |
| `scroll` | the scroll offset is not touched; when rows above the viewport are inserted or deleted the grid shifts the offset by their height so the row under the viewer's eye stays put |
| `selection` | the selected row (and a multi-selection) stays selected by key; a deleted selected row leaves the selection empty, never jumps to a neighbour |
| `sort` | the viewer's sort column and direction stay; a changed row moves to its sorted place, the rest do not re-sort |
| `filters` | dataset filters stay; a changed row that no longer matches leaves the view, one that now matches enters |
| `expanded` | expanded detail rows stay expanded by key |
| `columns` | column visibility, order and widths stay |
| `dialogs` | an open dialog, context menu, inline editor or drag in progress is never closed by a change; a dialog over a deleted row shows that the row is gone and keeps the viewer's edits until they close it |
| `focus` | keyboard focus stays on the same key; a deleted focused row moves focus to the next row (or the previous when it was last) |

A resync replaces the row set but the viewer state above is restored by key on top of it. The one thing a change may
move is the row that changed; "the grid jumped" is a bug.

## Optimistic ops (`optimistic@1`, same engine)

A drag and drop, an inline edit or a delete shows at once and is confirmed by the store's echo:

1. The grid gives the local op a **client op id** (`opId`, unique per client) and applies it to a pending layer on
   top of the confirmed set. The view shows it immediately; the changed keys come back like any other change.
2. The store applies the op and emits the `live-change@1` event with `origin.opId` set. When it arrives, the pending
   op is confirmed: it leaves the pending layer and the event lands in the confirmed set. The view does not flicker
   (the engine reports changed keys only where the confirmed rows differ from what was shown).
3. **Reject**: the store answers the request with `{ "opId", "reason" }` (`conflict`, `forbidden`, `invalid`,
   `gone`, …): the pending op is rolled back, its keys are reported as changed with the reason so the grid can say
   why ("Someone moved that row first").
4. **Timeout**: a pending op not echoed within `OPTIMISTIC_TIMEOUT_MS` (8 000 ms default, a setting) is rolled back
   with reason `timeout`.
5. **Resync** rolls back every pending op (reason `resync`): the store's truth wins; the grid may re-submit.

Pending ops stay in order; a later op on the same key is applied on top of the earlier one. An echo that matches no
pending op is just a change from someone else (it may be the same session on another surface).

## Where the events come from

| Store | Emits | Status |
| --- | --- | --- |
| Builds store (`builds@1`, `_claude/builds`) | one event per build row / step change, `ns` `builds` and `builds/<id>/steps` | this build (later phases) |
| Planner, UI Review, notes, plugin data | through `data-store@1 watch` mapped as above | this build (later phases) |
| Any plugin's own rows | `plugin_services.get("axf.live-changes@1").emit(event)` | this build (later phases) |

A store that cannot number its changes contiguously is not live: it must either adopt the rev line or fall back to
"resync on every change" (`since` always answers with a resync), which is still correct, only heavier.

## Not yet

- The console's live transport (SSE endpoint, DataGrid hook `useLiveRows`), the CLI / MCP / voice reads and the
  builds store emitter: later phases of build `live-hot-refresh-every-grid-list-re`.
- Cross-device: a phone attaching to a hub row set over AXPP (same frames, hub transport).
- Kotlin twin (`LiveRows.kt` replaying `live-rows.json`): deferred, Android on hold.
