# Notes & tasks — one plugin, one store (notes-tasks@1)

Build `one-to-do-notes-and-tasks-plugin-in-the-console-take-it-out-of-amberx`, step s1 (design, Fable, Nov 12 2026).
This folder becomes the console plugin `notes-tasks` ("Notes & tasks"). Until the Opus phase lands its code, this
document and `schema/notes-tasks.schema.json` are the contract every later step builds to.

**Changed Nov 13 2026** (build `change-to-one-to-do-notes-and-tasks-plugin-pr-527-brett-notes-tasks-and-to`, Brett):
notes, tasks and to-dos are **one item type**, not separate things, and any item can hold any other, **nested to any
depth**: a note holds task lists and to-do lists, a task or to-do list holds notes, lists nest inside lists inside
notes. The sections below are the revised contract; where they differ from the first draft, they win:

- one row shape, `item`, for everything; `kind` is gone as a type and lists are no longer a separate thing;
- what an item shows is its **look** (`note`, `todo`, `task`, `list`, or one Brett adds), a preset that can change
  at any time without losing a field;
- **`parent`** is any item; there is no depth limit and no rule about which look may hold which;
- amberx-notes@1 rows still read unchanged (`kind` → look, a `lists` row → an item that holds its rows).

## What exists today (three stores, three shapes)

| Where | Format | Lives | Shape |
|---|---|---|---|
| AmberX `plugins/notes` + `plugins/tasks` (phone, web) | `amberx-notes@1` (`apps/amberx-droid/src/plugins/notes/web/core.ts`) | axHub data server, hub project `amberx-axf`, folder `amberx-notes/`, hub-table@1 tables `lists` + `items` (lib-hubstore) | lists tree (system lists `inbox`, `plugins`, `voice-notes`); items `note | todo | task`, status `open | doing | done`, priority 0–3, due ISO, tags, checklist, subtasks (`parent`), pinned / starred, transcript / summary, source, url. Voice + AI intents (`parseIntent` / `applyIntent`). |
| Console `todo-manager` | `todo-store@1` (`server/model.py`) | one JSON file per project in the plugin's data dir | lists with nested groups (int ids, tone, icon); entries `note | todo | task` with status `open | in_progress | blocked | done`, priority `low | normal | high | urgent`, due ms, tags, checklist, subtasks, **custom fields per kind** and a **type schema** (what each kind must / may hold) edited in Settings. Tree / grid views, bulk actions, Markdown export. |
| Console `notes-browser` | Markdown files, axHub memory semantics (`server/store.py`) | `/projects/_shared/_claude/notes/` (base project) or `project-notes/<id>/`; versions + attribution in `.axhub/claude/shared/` | folders → notes (`.md` / `.txt`), version = sha256 prefix, conflict-safe save, history kept. Provides `axf.notes@1` (MD Studio). |
| control@1 `amberx.items` / `amberx.lists` | amberx-notes@1 | token-control `lib/amberx.mjs` writes the AmberX hub tables on the mounted `/projects` | the CLI aliases `axf note | todo | task | list …`, MCP `amberx_*`, REST `/api/control/…` |

The AmberX app also reads the console's Voice notes (hub folder `voice-notes/`, tables `lists` + `notes`) read-only under
its Voice notes list (`fromVoiceNotes`). Nothing here changes that.

## Decision

**One format, one store, one engine, one plugin.**

- **Format `notes-tasks@1`** has one item type for notes, to-dos, tasks and lists, nested to any depth. Every row
  AmberX has written still reads (its `kind` is read as the look, its lists as holder items). It absorbs what the
  Todo manager had that AmberX lacked (custom fields, an editable schema of what each look shows, tones, a `blocked`
  status) and nothing from the Todo manager that AmberX already covered differently (int ids, enum priorities, ms
  dates: those are mapped once on import).
- **One store per project on axHub**, hub-table@1 through lib-hubstore, hub project `amberx-axf`:
  - base project AmberX AXF (projects@1 `base`): folder **`amberx-notes/`**, tables `lists` + `items`: the rows AmberX
    writes today. The base project's store *is* the AmberX store from day one, no copy, no cut-over.
  - any other project `<id>`: folder **`notes-<id>/`**, same tables, empty at first (projects@1 rule: a new project
    starts fresh). One segment, so it is a safe lib-hubstore folder name. The console only ever creates rows in
    `items`; `lists` holds the system roots and whatever the phone wrote before it moved to the engine.
  - the per-project looks and view preferences: hub-settings@1 document **`settings/notes-tasks.json`** (base) /
    **`settings/notes-tasks-<id>.json`**, key `looks` (below) and `view.*`.
- **Documents stay files.** Brett's saved notes keep their hub memory semantics (versions, attribution,
  `axhub.memory_read`, `claude-sync`, MD Studio all read them). The plugin absorbs the Notes browser code
  (`store.py` → `server/docs.py`), keeps providing **`axf.notes@1`**, and *projects* the files into the tree as the
  system item **`documents`**: one read-through holder item per folder, one read-through item (look `note`) per file
  (`id: "doc:<path>"`). A doc opens in the same right pane with the edit switch, save, rename, move, history, delete.
  Moving a doc under any ordinary item copies it as a note (exactly how a Voice note is adopted); the file is
  untouched.
- **Voice notes** keep their read-through projection (`vn-` ids) under the system item `voice-notes`, unchanged.
- **One pure engine**, `framework/core/engines/notes-rules.mjs` (+ `notes-rules.d.mts`): the AmberX notes core and
  tasks core move into the framework (they are a cross-app protocol: phone, console, CLI and AmberX voice all apply
  the same rules). AmberX's `plugins/notes/web/core.ts` and `plugins/tasks/web/core.ts` become re-exports;
  token-control's `gen-amberx-core.mjs` / `lib/amberx-core.gen.mjs` are retired (control imports the engine). Fixture
  `framework/spec/fixtures/notes.json`, check `framework/spec/check-notes.mts`; the console server's Python mirror
  `server/model.py` replays the same fixture in `test.py`. Kotlin twin deferred (PORTING.md).
- **One writer path from the console.** The console UI only calls the plugin's REST API; the server writes the hub
  through the data server's HTTP API (`AXHUB_URL` + `AXHUB_TOKEN` from the console credentials, ETag / If-Match,
  409 → re-read, re-apply, retry ×3) so axHub stays the single authority and the phone's writes are never clobbered.
  Where the console has no hub token (dev, tests) it falls back to the mounted files
  `/projects/amberx-axf/_data/<folder>/<table>/head.json` (+ `rows-N.json`), written the way `HubTable.write` does
  (what `lib/amberx.mjs` does today). The phone keeps writing the hub directly (it has no server); both sides run the
  same engine, so both enforce the same rules.
- **Plugin `notes-tasks` replaces three**: console `todo-manager` and `notes-browser` are retired in the last step
  (their `uninstall.mjs`, README lines re-marked); AmberX's `notes` + `tasks` plugins stay as the phone's UI but on the
  framework engine and the per-project folder: AmberX's own store code shrinks to the hub queue.

## The data model: one item type

Ids are strings (AmberX style: `n-…` / `d-…` / `t-…` / `l-…` by the look an item had when it was made, the prefix
means nothing afterwards; `tm-<n>` for rows imported from a todo-store@1 file; `vn-…` and `doc:…` only ever appear in
projections, never in the tables).

There is one thing: the **item**. A note, a to-do, a task, a to-do list, a task list and a folder of lists are all
items; they differ only in their **look** and in what they hold. Any item can hold any other (`parent`), to any depth,
whatever either look is. Examples, all one row shape:

```
Trip to Lisbon            look note   text "Flights booked, hotel near…"
├─ Packing                look list   childLook todo
│  ├─ Passport            look todo   status done
│  └─ Chargers            look todo
│     └─ Which cables     look note   text "USB-C ×2, the watch one"
├─ Bookings               look task   status doing, due 2026-11-20, childLook task
│  └─ Dinner Friday       look task   priority 2
└─ Ideas                  look list
   └─ Day trips           look list
      └─ Sintra notes     look note
```

### Item (`items` table row)

| Field | Type | Notes |
|---|---|---|
| `id` | string | row key |
| `parent` | string | the item (or legacy `lists` row) that holds this one, `''` = the project root. Any item may hold any item; the only refused move is one that makes an item its own ancestor. Children render after the parent's body, in `order`. |
| `order` | number | position among siblings |
| `look` | look id | `note` · `todo` · `task` · `list` · one Brett added; what is shown and asked for, never what is allowed. Unknown → `note`. Changing it keeps every field. |
| `childLook` | look id | the look a new child gets: a to-do list is an item with `childLook: todo`, a task list one with `task`; absent = the look's own `childLook`, else `note`. Any child may still have any look. |
| `collapsed` | boolean | children folded in the tree (shared view state) |
| `title` | string ≤ 160 | derived from the text when empty |
| `text` | string ≤ 20 000 | body (Markdown) |
| `summary` | string ≤ 2 000 | AI or hand summary |
| `transcript` | string | what was heard, as said |
| `tags` | string[] ≤ 20 | lower-case, dashed |
| `pinned`, `starred` | boolean | |
| `icon`, `tone` | icon id, `accent | info | success | warning | danger | neutral` | any item (was list-only); the UI maps tone to `--fx-*` tokens, never a literal colour |
| `aliases` | string[] ≤ 10 | spoken names, so voice can find any item to add to ("add milk to shopping") |
| `system`, `pluginId` | `inbox | plugins | voice-notes | documents | plugin` | system items sit at the root; renamed, never removed or moved |
| `status` | `open | doing | blocked | done` | any item may carry one; it is shown when the look has a checkbox. Absent = `open`. |
| `priority` | 0 \| 1 \| 2 \| 3 | none · low · medium · high |
| `due` | string | `YYYY-MM-DD` or ISO date-time, `''` = none |
| `source` | `voice | typed | ai | web | import | console` | |
| `url` | string | page address for web clips / the Todo manager's `source` url field |
| `fields` | object | custom fields by key; they belong to the item, not its look (`text`, `textarea`, `number`, `date` (ms), `select`, `checkbox`, `url`, `tags`) |
| `createdAt`, `updatedAt`, `doneAt` | ISO string | `doneAt` set when status becomes `done`, cleared when it leaves it |
| `by`, `device` | string | who / which device wrote it |
| `kind` | `note | todo | task` | **legacy mirror**: read as the look when `look` is absent; written from the look (`note` for `list` and added looks) so amberx-notes@1 readers keep working; never read when `look` is set |
| `list` | string | **legacy mirror**: read as the parent when `parent` is `''`; written as the nearest ancestor that is a `lists` row (else `inbox`) |
| `checklist` | `{id, text, done}[]` | **legacy**: read as checkable children (`ck:<item>:<id>`); the console's first write to the item turns them into child items with look `todo` and empties it |

Computed by the engine, never stored: `depth`, `path` (ancestor ids), `children`, and for every item the roll-ups
`count` (descendants), `checkable` / `done` (descendants whose look has a checkbox, and how many are done), `today`
(due today or overdue, open) and `next` (earliest open due date below it). A holder's progress (`3 / 7`) is these.

### Nesting to any depth (engine rules)

- **Any holds any.** No look restricts what it may hold or be held by. A `todo` can hold a note; a note can hold a
  task list that holds notes that hold to-do lists.
- **No depth limit** in the format or the UI. The engine walks the tree iteratively (no recursion limit to hit) and
  stops at a corruption guard of 1 000 levels, reported as a store warning, never as a user rule.
- **No cycles.** `canMove(id, parent)` is false when `parent` is the item or one of its descendants; an item whose
  ancestor chain loops on read (two clients raced) is shown under the root with a warning until moved.
- **Orphans** (parent missing) show under the root, flagged; nothing is deleted.
- **Moving** an item moves its whole subtree (one row changes). `POST /items/{id}/move {parent, before?|after?}`.
- **Deleting** an item asks what happens to what it holds: `children: delete` (the whole subtree, one confirm with
  the count) or `children: lift` (they move up to its parent, in place). The default is `lift` for voice, the
  dialog asks in the UI.
- **Ticking** an item with a checkbox ticks only it. `cascade: true` (the "complete all" action) also ticks every
  open checkable descendant; `doneWhenChildrenDone` is a view preference, off by default.
- **Duplicating** copies the subtree with new ids (`duplicate {deep: true}`); merging keeps the first item and
  re-parents every other item's children under it.
- **Tabs and filters see every depth**: Today / Upcoming / Todo / Done are flat lists of matching items wherever they
  sit, each with its path as a breadcrumb; All and the tree show the hierarchy. `deep: false` limits a query to
  direct children.
- **Counts stay cheap**: roll-ups are computed in one pass over the store per read (post-order), not per node.

### Looks (settings document, key `looks`)

A look is a preset over the one item type (the Todo manager's per-kind type schema, generalised): `label`, `icon`,
`tone`, `checkbox` (a tick box, counts towards its holders' progress), `show` (each of `body status priority due tags`
→ `required | optional | hidden`), `statuses` (offered in the UI; a stored status outside it is kept and shown),
`statusLabels`, `priorityLabels`, `defaultStatus`, `defaultPriority`, `childLook`, `fields[]` (`key`, `label`,
`type`, `required`, `options`, `placeholder`, `showInGrid`). Built-ins, always present (editable, not removable):

| Look | Checkbox | Shows | Statuses | childLook |
|---|---|---|---|---|
| `note` | no | body, tags | – | `note` |
| `todo` | yes | title, due, tags (body optional) | open · done | `todo` |
| `task` | yes | body, status, priority, due, tags | open · doing · blocked · done | `task` |
| `list` | no | title, progress of its children | – | `todo` |

Brett may add up to 12 more (e.g. `idea`, `bug`) in Settings → Plugins → Notes & tasks. The engine's
`validateItem(item, looks)` checks only what the item's look marks `required` and the look's custom fields; a write
that breaks one is refused unless `draft: true`, in which case it is saved and the answer carries `warnings` (this is
how a voice "add a task: call mum" survives a look that requires an estimate). Hidden never means invalid: a field the
look hides is kept and comes back when the look changes.

### Projections (read-only items the engine adds to a view)

- `voice-notes`: `fromVoiceNotes(lists, notes)` as today (`vn-<id>`), under the system item `voice-notes`, look
  `note`, source `import`.
- `documents`: `fromDocuments(listing)`: one holder `doc-folder:<folder>` per folder, one item `doc:<path>` per file,
  look `note`, `title` from the first heading, `text` loaded on open, `updatedAt` / `by` from the hub's meta. Writes
  to a doc go to the documents store (versioned); `adopt` copies it under any item as a note.
- Legacy rows: each `lists` row is read as an item (`name` → `title`, look `list`, `childLook` = the most common
  kind among its rows); each legacy item's `list` is read as its `parent` and its `parent` (subtask) wins when set.

### Mapping todo-store@1 → notes-tasks@1 (one-time import, `importTodoStore`)

| todo-store@1 | notes-tasks@1 |
|---|---|
| list `id` (int), `parentId`, `title`, `tone`, `icon`, `sortOrder` | an item `tm-l<id>`, look `list`, `parent` `tm-l<parentId>` or `''`, `title`, `tone`, `icon`, `order` |
| entry `id`, `listId`, `parentId`, `kind`, `title`, `body`, `tags`, `checklist`, `sortOrder` | an item `tm-<id>`, `parent` = `tm-<parentId>` else `tm-l<listId>`, look = `kind`, `title`, `text`, `tags`, child `todo` items from `checklist`, `order` |
| status `open | in_progress | blocked | done` | `open | doing | blocked | done` |
| priority `low | normal | high | urgent` | 1 · 0 · 2 · 3 |
| `dueAt` ms | `due` `YYYY-MM-DD` (local day) |
| `createdAt` / `updatedAt` / `completedAt` ms | ISO `createdAt` / `updatedAt` / `doneAt` |
| `fields` (custom) | `fields` as they are; a `url`-typed `source` field also fills `url` |
| `types` (per kind) | the settings document's `looks` `note` / `todo` / `task` (statuses mapped as above) |
| | `source: import`, `by: console:todo-manager` |

Imported once per project when the plugin first starts and finds `<todo-manager data dir>/[projects/<id>/]store.json`
and the project's `items` table is empty; the file is then renamed `store.json.migrated`. `POST /import` runs the
same mapping on a posted todo-store@1 or amberx-notes@1 JSON export by hand.

## The engine (`framework/core/engines/notes-rules.mjs`)

Pure, no IO, the one place the rules live. One tree of items, so the AmberX notes core's separate list and item
operations collapse into one set:

- normalisation: `normalizeItem` (reads every legacy shape: `kind` → `look`, `list` → `parent`, a `lists` row →
  `fromListRow`, `checklist` → checkable children), `ensureSystemItems` (inbox, plugins, voice-notes, documents),
  `storeFolder(project)`, `settingsFile(project)`;
- the tree, iterative, any depth: `buildTree(rows)` (one pass; children, `depth`, `path`, roll-ups `count`,
  `checkable`, `done`, `today`, `next`; cycle and orphan warnings), `childrenOf`, `ancestors`, `descendants`,
  `flatTree(rows, {expanded})`, `canMove(rows, id, parent)`, `breadcrumb`;
- writes: `addItem({parent, look?, …})` (look = the parent's `childLook` when not given), `updateItem` (a look change
  keeps every field), `moveItems(ids, parent, {before|after})`, `reorder(parent, ids)`,
  `removeItems(ids, {children: delete|lift})`, `duplicate(ids, {deep})`, `mergeItems`, `check(id, done, {cascade})`,
  `extractCheckboxes` (Markdown `- [ ]` lines in a body become `todo` children);
- finding: `search`, `allTags`, `findItem` (by id, title, alias or a spoken path "trip, packing"), `latest`;
- dates: `dueBucket`, `spokenDate`, `spokenPriority`, `parseDue`, `dueLabel`;
- views: `tabItems` (Today / Upcoming / Todo / All / Done, every depth, with breadcrumbs), `byDue`, `filterItems`,
  `tabCounts`, `todayCount`, `groupBy` (parent, look, status, priority, tag, due), `quickAdd`, `cycleStatus`;
- looks: `sanitizeLooks`, `lookOf(item, looks)`, `validateItem(item, looks)`;
- intents: `parseIntent`, `validateIntent`, `applyIntent`, `isOwnReply`, `INTENT_SCHEMA` (`add` gains `parent` and
  `look`: "add a to-do list called packing to my trip note", "add passport to packing");
- bulk: `done`, `undone`, `move`, `merge`, `pin`, `star`, `tag`, `untag`, `look`, `delete`, `duplicate`, `patch`;
- export: `toMarkdown(rows, rootId)` (nesting as indented Markdown: headings for holders down to `###`, then nested
  bullets and `- [ ]` / `- [x]` to any depth), `toJson`;
- projections and import: `fromVoiceNotes`, `fromDocuments`, `fromListRow`, `importTodoStore`.

Fixture `spec/fixtures/notes.json`: rows in / rows out for normalisation (every legacy shape), a deep mixed tree
(note → list → todo → note → task list, 12 levels) with its roll-ups, cycle and orphan cases, move / delete-lift /
delete-subtree / duplicate-deep / cascade tick, look changes keeping fields, look validation, the import mapping,
intent sentences → intents → `say`, tab picks on a fixed clock, Markdown export of a nested tree. `check-notes.mts`
replays it on the TS side; `server/test.py` on the Python mirror. Every port passes the same file.

## Everything comes with an API (Brett, Nov 8 2026)

The plugin's REST routes are the only way the console UI changes data; plugin-commands@1 (`commands.auto: true`)
projects them to MCP tools `notes-tasks_<command>`, REST `/api/control/notes-tasks/<command>` and the CLI
`axf notes-tasks <command>`. control@1's `amberx.items` / `amberx.lists` (and the aliases `axf note | todo | task |
list`, MCP `amberx_*`) keep their names (the spec is append-only) and run on the same engine and store: `amberx.items`
gains `parent`, `look`, `childLook`, `fields`, `blocked` in `status`; `amberx.lists` becomes a view of items with
look `list` (create → an item with look `list`); both gain `select.project` (default: the active project) and
`select.under` (an item id: its whole subtree). `axf note | todo | task | list` set the look and accept `--in <id or
title path>`. AmberX voice sends its sentence to `POST /intent` when the console is reachable and runs the same
engine locally when it is not: the same intent, the same `say` ("add a task list called bookings to my trip note").

| In the UI | REST (`/api/plugins/notes-tasks/…`) | MCP / CLI (auto) | Deep link (`console_show` target) |
|---|---|---|---|
| The whole screen (tree + counts + hub state) | `GET /state?project=` | `notes-tasks_state` / `axf notes-tasks state` | `notes-tasks` |
| The tree at any depth | `GET /tree?root=&depth=` (`depth` absent = all; roll-ups included) | `notes-tasks_tree` | `notes-tasks/item/<id>` opens the item with its ancestors expanded |
| Items (Today / Upcoming / Todo / All / Done tabs, filters) | `GET /items?q&look&status&under&deep&tag&due&pinned&starred&tab&group&limit` | `notes-tasks_items` | `notes-tasks/tab/<today|upcoming|todo|all|done>` |
| New item anywhere (note, to-do, task, list, or any look; quick add; the item dialog) | `POST /items {parent?, look?, title?, text?, …, draft?}` → `{item, warnings}` | `notes-tasks_items_create` | `notes-tasks/item/<id>/edit` opens the dialog |
| Edit, change look, tick, pin, star, due, priority, fold | `PUT /items/{id}`, `POST /items/{id}/check {done, cascade?}` | `_items_update`, `_items_check` | |
| Move (drag in the tree, "Move to…") | `POST /items/{id}/move {parent, before?, after?}`, `POST /items/reorder {parent, ids}` | `_items_move`, `_items_reorder` | |
| Group actions on a selection | `POST /items/bulk {ids, action, …}` | `_items_bulk` | |
| Delete (asks about what it holds) | `DELETE /items/{id}?children=lift|delete` | `_items_delete` (confirm token) | |
| Say it (voice sentence or typed command) | `POST /intent {text | intent, source?, transcript?}` → `ApplyResult` | `notes-tasks_intent` | |
| Documents (folders, open, edit switch, save, rename, move, history, delete, new folder) | `GET /docs?q`, `GET /doc?path`, `PUT /doc {path, content, if_version?}`, `POST /doc/move`, `DELETE /doc`, `GET /doc/history`, `POST /folder`, `DELETE /folder` | `notes-tasks_docs`, `_doc`, `_doc_save`, `_doc_move`, `_doc_delete` (confirm), `_doc_history`, `_folder_create`, `_folder_delete` | `notes-tasks/doc/<path>` |
| Adopt a Voice note / document under any item | `POST /items/adopt {ids, parent}` | `_items_adopt` | |
| Export any item with everything it holds | `GET /export.md?root=`, `GET /export.json?root=` | `_export_md`, `_export_json` | |
| Import | `POST /import {$axf: todo-store@1 | amberx-notes@1, …}` | `_import` | |
| Settings → Plugins → Notes & tasks: looks editor, view prefs | `GET /looks`, `PUT /looks`, `GET /prefs`, `PUT /prefs` | `_looks`, `_looks_save`, `_prefs`, `_prefs_save` | `console_settings` `plugins/notes-tasks` |
| Live updates | `GET /events` (SSE; `skip` in plugin-commands) | – | – |

`/lists` routes from the first draft are not added: a list is an item (`POST /items {look: "list"}`).

Web actions registered on the runtime (so `console_action` and search reach them): `notes-tasks.new` (with
`{look, parent}`), `.new-note`, `.new-todo`, `.new-task`, `.new-list` (each under the selected item), `.quick-add`,
`.view.tree`, `.view.grid`, `.group.<parent|look|status|priority|tag|due>`, `.tab.<today|upcoming|todo|all|done>`,
`.expand-all`, `.collapse-all`, `.export`. Nav badge counter `tasks.today` (Today + overdue at every depth, hidden at
0). Reads: `info`, `data`, `data-file` come free; the store itself is on the hub, so `data` lists the import marker
files only.

## UI (the Opus phase; every colour, size, font, radius from `--fx-*` tokens, framework controls only)

- Nav → Notes & tasks (tabable `notes-tasks`, label "Notes", icon `list`). Left pane: one tree (TreeView) of items
  at any depth: Inbox, Brett's items, Plugins, Voice notes, Documents; every node shows its look's icon and, when it
  holds checkable items, its `done / checkable` progress; drag to move or to nest (drop on an item = inside it,
  between = beside it); fold state saved on the item.
- Right pane: the open item as a page: title, the look switch (SelectField over the looks), the body, then what it
  holds, each child rendered by its own look (a note as a card with its body, a to-do as a tick row, a task as a row
  with status, priority and due) and itself expandable in place to any depth. "Add" under each holder adds a child
  with the holder's `childLook`; its menu offers every look. Indentation steps come from `--fx-dens-*` tokens and
  stop growing after six levels on desktop and three on the phone (deeper levels keep a depth marker instead of more
  indent, so nothing runs off the screen); the breadcrumb always shows the full path.
- TabGroup Today / Upcoming / Todo / All / Done above the page: flat lists from every depth with breadcrumbs; All is
  the tree. Toolbar (`role="toolbar"`, aria-label) with quick add, view tree / grid, group by, filters (look, status,
  priority, tag, due), search, expand / collapse all, export, selection actions. Grid = the Todo manager's DataGrid
  with a path column and custom `showInGrid` fields.
- Item dialog `dialog:notes-tasks.item`: the look's parts and custom fields as the looks say; draft save with
  warnings. Documents open in the right pane with the edit switch and conflict-safe save (409 → reload).
- Settings → Plugins → Notes & tasks: looks editor (per look: label, icon, tone, checkbox, show rules, statuses,
  defaults, childLook, custom fields; add / remove added looks), view prefs, hub state, import, Install & uninstall
  panel.
- Phone: tree collapses to a drawer; the page stays; tabs stay. Desktop and phone shots to UI Review before the PR is
  called ready.

## Lifecycle (plugin-lifecycle@1)

`dataDir .axf-console/plugins/notes-tasks` holds only the import markers and a local fallback store when there is no
hub (`AXF_NOTES_DIR` overrides). `env`: `AXHUB_URL`, `AXHUB_TOKEN`, `AXHUB_PROJECTS_DIR`, `AXF_NOTES_DIR`.
`install.mjs` / `uninstall.mjs` through `framework/cli/plugin-lifecycle.mjs`; `hooks.mjs` checks: data folder, hub
reachable, the active project's tables readable, the documents folder mounted. Uninstall removes the plugin's own
data dir only: the hub tables and Brett's documents are his and stay. Provides `view:notes-tasks`,
`dialog:notes-tasks.item`, `settings-tab:notes-tasks`, `service:axf.notes@1` (documents), `service:axf.notes-tasks@1`
(the engine over the active project's store, for other plugins: Plan Studio's "make a task from this step", the
assistant). Cross-plugin only through these services, never by folder name.

## Steps after this one (proposed for the orchestrator; Opus unless marked)

1. **s2 (Fable, engine)** `framework/core/engines/notes-rules.mjs` + `.d.mts`: the one-item tree (above) built from
   the two AmberX cores + the Todo manager rules; fixture `spec/fixtures/notes.json` (deep mixed trees, cycles,
   legacy rows); `spec/check-notes.mts`; AmberX cores become re-exports over it (`apps/amberx-droid/test.mjs` still
   green: they keep reading `kind` / `list`, which the engine keeps writing); token-control imports the engine, gen
   script retired; control-rules append (`parent`, `look`, `childLook`, `fields`, `blocked`, `select.project`,
   `select.under`), `schemas/control.json` + `fixtures/control.json` regenerated.
2. **s3 (server)** `server/model.py` (Python mirror replaying the fixture), `server/hub.py` (hub-table@1 over the
   data server's HTTP API with If-Match retry, mounted-file fallback), `server/docs.py` (the Notes browser store,
   moved), `server/__init__.py` routes above, import on first start, `test.py`.
3. **s4 (web)** the view: tree, item page with nested children by look, tabs, grid, dialog, toolbar, actions, nav
   badge, SSE refresh; check-theme, check-controls, check-toolbars green.
4. **s5 (web)** Settings sub-tab (looks editor, prefs, hub state, import, lifecycle panel); `help.json`.
5. **s6 (AmberX)** `plugins/notes` + `plugins/tasks` on the engine and the per-project folder, showing nested items
   (the phone's notes and tasks screens become two filtered views of the same tree); `POST /intent` when the
   console is reachable; `amberx-droid/test.mjs`. After this the phone stops writing `lists` rows.
6. **s7 (retire)** `todo-manager` and `notes-browser` removed through their `uninstall.mjs`; README / STATUS lines
   re-marked `<!-- axf-plugin:notes-tasks -->`; `framework/catalog/status.json`; PORTING twin line kept current;
   UI Review submission; PR says how every feature is reached (the table above).

## Known gaps, stated

- Children render after the parent's body, not at a chosen spot inside it. Placing a list mid-note (an anchor in the
  Markdown) is a later addition; the `text` format leaves room for it (`{{item:<id>}}`) but nothing reads it yet.
- Until s6, a phone on the old AmberX code shows items nested under a note or a to-do as subtasks of their top
  ancestor in that ancestor's list (it reads the `list` / `kind` mirrors); nothing is lost and its writes stay valid.
- Live follow of the phone's writes is a 30 s / on-focus re-read of `head.json` through the server (SSE to the UI),
  not a push: the hub's `/data-events` follow is the lib-hubstore placeholder `axf.hubstore.live`.
- Two writers (phone via HTTP, console via HTTP) are safe through If-Match; the mounted-file fallback is last-write-wins
  and is for dev / tests only (the same risk `lib/amberx.mjs` carries today). A race that makes a cycle is caught on
  read (shown under the root, flagged) and never loops.
- A project that is archived keeps its folder on the hub; nothing deletes a store.
- Kotlin twin of the engine: deferred (PORTING.md), Android on hold.
