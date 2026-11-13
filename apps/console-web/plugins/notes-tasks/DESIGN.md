# Notes & tasks — one plugin, one store (notes-tasks@1)

Build `one-to-do-notes-and-tasks-plugin-in-the-console-take-it-out-of-amberx`, step s1 (design, Fable, Nov 12 2026).
This folder becomes the console plugin `notes-tasks` ("Notes & tasks"). Until the Opus phase lands its code, this
document and `schema/notes-tasks.schema.json` are the contract every later step builds to.

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

- **Format `notes-tasks@1`** is a strict superset of `amberx-notes@1`: every row AmberX has written is already a valid
  row. It absorbs what the Todo manager had that AmberX lacked (custom fields per kind, a per-kind type schema, list
  tones, a `blocked` status) and nothing from the Todo manager that AmberX already covered differently (int ids,
  enum priorities, ms dates: those are mapped once on import).
- **One store per project on axHub**, hub-table@1 through lib-hubstore, hub project `amberx-axf`:
  - base project AmberX AXF (projects@1 `base`): folder **`amberx-notes/`**, tables `lists` + `items`: the rows AmberX
    writes today. The base project's store *is* the AmberX store from day one, no copy, no cut-over.
  - any other project `<id>`: folder **`notes-<id>/`**, same tables, empty at first (projects@1 rule: a new project
    starts fresh). One segment, so it is a safe lib-hubstore folder name.
  - the per-project type schema and view preferences: hub-settings@1 document **`settings/notes-tasks.json`** (base) /
    **`settings/notes-tasks-<id>.json`**, key `types` (the Todo manager's type schema, below) and `view.*`.
- **Documents stay files.** Brett's saved notes keep their hub memory semantics (versions, attribution,
  `axhub.memory_read`, `claude-sync`, MD Studio all read them). The plugin absorbs the Notes browser code
  (`store.py` → `server/docs.py`), keeps providing **`axf.notes@1`**, and *projects* the files into the tree as the
  system list **`documents`**: one sub-list per folder, one read-through item of kind `doc` per file
  (`id: "doc:<path>"`). A doc opens in the same right pane with the edit switch, save, rename, move, history, delete.
  Moving a doc into an ordinary list copies it as a note (exactly how a Voice note is adopted); the file is untouched.
- **Voice notes** keep their read-through projection (`vn-` ids) under the system list `voice-notes`, unchanged.
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

## The data model

Ids are strings (AmberX style: `l-…` lists, `n-…` / `d-…` / `t-…` items by kind; `tm-<n>` for rows imported from a
todo-store@1 file; `vn-…` and `doc:…` only ever appear in projections, never in the tables).

### List (`lists` table row)

| Field | Type | Notes |
|---|---|---|
| `id` | string | row key |
| `name` | string ≤ 80 | |
| `parent` | string \| null | tree, ≤ 7 levels (`MAX_DEPTH` 6) |
| `order` | number | sibling order |
| `system?` | `inbox | plugins | voice-notes | documents | plugin` | system lists are renamed, never removed or moved out of the root |
| `pluginId?` | string | `system: plugin` only |
| `icon?` | string | icon id |
| `tone?` | `accent | info | success | warning | danger | neutral` | **new** (Todo manager); the UI maps it to `--fx-*` tokens, never a literal colour |
| `aliases?` | string[] ≤ 10 | spoken shortcuts |
| `createdAt`, `updatedAt` | ISO string | |

Counts (`entries`, `done`, `today`) are computed by the engine, never stored.

### Item (`items` table row)

| Field | Type | Notes |
|---|---|---|
| `id` | string | row key |
| `kind` | `note | todo | task` | `doc` exists only in projections |
| `list` | string | a list id; unknown → `inbox` |
| `title` | string ≤ 160 | derived from the text when empty |
| `text` | string ≤ 20 000 | body (Markdown) |
| `summary` | string ≤ 2 000 | AI or hand summary |
| `transcript` | string | what was heard, as said |
| `tags` | string[] ≤ 20 | lower-case, dashed |
| `pinned`, `starred` | boolean | |
| `status` | `open | doing | blocked | done` | **`blocked` new** (Todo manager); todos use `open | done` only |
| `priority` | 0 \| 1 \| 2 \| 3 | none · low · medium · high |
| `due` | string | `YYYY-MM-DD` or ISO date-time, `''` = none |
| `checklist` | `{id, text, done}[]` ≤ 100 | |
| `parent` | string | the task this is a subtask of, `''` = top level; a subtask lives in its parent's list |
| `order` | number | |
| `source` | `voice | typed | ai | web | import | console` | **`console` new** |
| `url` | string | page address for web clips / the Todo manager's `source` url field |
| `fields` | object | **new**: custom fields by key, as the kind's type schema declares them (`text`, `textarea`, `number`, `date` (ms), `select`, `checkbox`, `url`, `tags`) |
| `createdAt`, `updatedAt`, `doneAt` | ISO string | `doneAt` set when status becomes `done`, cleared when it leaves it |
| `by`, `device` | string | who / which device wrote it |

### Types (settings document, key `types`)

The Todo manager's `sanitize_types` shape, per kind (`note`, `todo`, `task`): `label`, `icon`, `tone`, `core` (each of
`body status priority due tags checklist subtasks` → `required | optional | hidden`), `statuses` (a subset of the four
canonical statuses, the kind's allowed ones, with `labels`), `defaultStatus`, `defaultPriority`, `fields[]`
(`key`, `label`, `type`, `required`, `options`, `placeholder`, `showInGrid`). Defaults are the Todo manager's, with its
statuses and priorities mapped (below). Settings → Plugins → Notes & tasks edits it; the engine's `validateItem(kind,
item, types)` enforces it on every write, on both the console and the phone. A write that breaks a `required` rule is
refused unless `draft: true`, in which case it is saved and the answer carries `warnings` (this is how a voice "add a
task: call mum" survives a type that requires an estimate).

### Projections (read-only rows the engine adds to a view store)

- `voice-notes`: `fromVoiceNotes(lists, notes)` as today (`vn-<id>`), source `import`.
- `documents`: `fromDocuments(listing)`: one sub-list `doc-folder:<folder>` per folder, one item `doc:<path>` per file,
  kind `doc`, `title` from the first heading, `text` loaded on open, `updatedAt` / `by` from the hub's meta. Writes to
  a doc go to the documents store (versioned); `adopt` copies into a list as a `note`.

### Mapping todo-store@1 → notes-tasks@1 (one-time import, `importTodoStore`)

| todo-store@1 | notes-tasks@1 |
|---|---|
| list `id` (int), `parentId`, `title`, `tone`, `icon`, `sortOrder` | `tm-<id>`, `parent`, `name`, `tone`, `icon`, `order` |
| entry `id`, `listId`, `parentId`, `kind`, `title`, `body`, `tags`, `checklist`, `sortOrder` | `tm-<id>`, `list`, `parent`, same kind, `title`, `text`, `tags`, `checklist`, `order` |
| status `open | in_progress | blocked | done` | `open | doing | blocked | done` |
| priority `low | normal | high | urgent` | 1 · 0 · 2 · 3 |
| `dueAt` ms | `due` `YYYY-MM-DD` (local day) |
| `createdAt` / `updatedAt` / `completedAt` ms | ISO `createdAt` / `updatedAt` / `doneAt` |
| `fields` (custom) | `fields` as they are; a `url`-typed `source` field also fills `url` |
| `types` | the settings document's `types` (statuses mapped as above) |
| | `source: import`, `by: console:todo-manager` |

Imported once per project when the plugin first starts and finds `<todo-manager data dir>/[projects/<id>/]store.json`
and the project's `items` table is empty; the file is then renamed `store.json.migrated`. `POST /import` runs the
same mapping on a posted todo-store@1 or amberx-notes@1 JSON export by hand.

## The engine (`framework/core/engines/notes-rules.mjs`)

Pure, no IO, the one place the rules live. From the AmberX notes core: `normalizeList`, `normalizeItem`,
`ensureSystemLists` (now four), tree ops (`childrenOf`, `ancestors`, `flatTree`, `descendants`, `itemsIn`,
`canMoveList`, `addList`, `renameList`, `moveList`, `reorderLists`, `removeList`), item ops (`addItem`, `updateItem`,
`moveItems`, `removeItems`, `mergeItems`, `extractCheckboxes`), finding (`search`, `allTags`, `findList`,
`findItem`, `latest`), dates (`dueBucket`, `spokenDate`, `spokenPriority`), intents (`parseIntent`, `validateIntent`,
`applyIntent`, `isOwnReply`, `INTENT_SCHEMA`), export (`toMarkdown`, `toJson`), projections (`fromVoiceNotes`).
From the AmberX tasks core: `tabItems` (Today / Upcoming / Todo / All / Done), `byDue`, `filterTasks`, `todayCount`,
`tabCounts`, `dueLabel`, `parseDue`, `quickAdd`, `cycleStatus`, checklist helpers. From the Todo manager:
`sanitizeTypes`, `validateItem(kind, item, types)` (core rules + custom fields), `bulk` (`done`, `undone`, `move`,
`merge`, `pin`, `star`, `tag`, `untag`, `delete`, `duplicate`, `patch`), `groupBy` (lists, kind, status, priority,
tag, due), `exportMarkdown(list)`. New: `fromDocuments`, `importTodoStore`, `storeFolder(project)`,
`settingsFile(project)`, `blocked` in `STATUSES`, `fields` in normalisation.

Fixture `spec/fixtures/notes.json`: rows in / rows out for normalisation (every legacy shape), type validation cases,
the import mapping, intent sentences → intents → `say`, tab picks on a fixed clock, Markdown export. `check-notes.mts`
replays it on the TS side; `server/test.py` on the Python mirror. Every port passes the same file.

## Everything comes with an API (Brett, Nov 8 2026)

The plugin's REST routes are the only way the console UI changes data; plugin-commands@1 (`commands.auto: true`)
projects them to MCP tools `notes-tasks_<command>`, REST `/api/control/notes-tasks/<command>` and the CLI
`axf notes-tasks <command>`. control@1's `amberx.items` / `amberx.lists` (and the aliases `axf note | todo | task |
list`, MCP `amberx_*`) keep their names (the spec is append-only) and run on the same engine and store; they gain
`select.project` (default: the active project), `blocked` in `status`, `fields: object` in `ITEM_FIELDS` and `tone` in
`LIST_FIELDS`. AmberX voice sends its sentence to `POST /intent` when the console is reachable and runs the same engine
locally when it is not: the same intent, the same `say`.

| In the UI | REST (`/api/plugins/notes-tasks/…`) | MCP / CLI (auto) | Deep link (`console_show` target) |
|---|---|---|---|
| The whole screen (tree + items + counts + hub state) | `GET /state?project=` | `notes-tasks_state` / `axf notes-tasks state` | `notes-tasks` |
| A list (tree pane) | `GET /lists`, `POST /lists {name, parent?, icon?, tone?, aliases?}`, `PUT /lists/{id}`, `DELETE /lists/{id} {itemsTo?}`, `POST /lists/reorder {ids}` | `notes-tasks_lists`, `_lists_create`, `_lists_update`, `_lists_delete` (confirm), `_lists_reorder` | `notes-tasks/list/<id>` |
| Items (tree or grid, Today / Upcoming / Todo / All / Done tabs, filters) | `GET /items?q&kind&status&list&deep&tag&due&pinned&starred&tab&group&limit` | `notes-tasks_items` | `notes-tasks/tab/<today|upcoming|todo|all|done>` |
| New note / to-do / task, quick add, the entry dialog | `POST /items {kind, list?, title?, text?, …, draft?}` → `{item, warnings}` | `notes-tasks_items_create` | `notes-tasks/item/<id>` opens the dialog |
| Edit, tick, pin, star, due, priority, move, checklist | `PUT /items/{id}`, `POST /items/{id}/check {item, done}` | `_items_update`, `_items_check` | |
| Group actions on a selection | `POST /items/bulk {ids, action, …}` | `_items_bulk` | |
| Delete | `DELETE /items/{id}` | `_items_delete` (confirm token) | |
| Say it (voice sentence or typed command) | `POST /intent {text | intent, source?, transcript?}` → `ApplyResult` | `notes-tasks_intent` | |
| Documents pane (folders, open, edit switch, save, rename, move, history, delete, new folder) | `GET /docs?q`, `GET /doc?path`, `PUT /doc {path, content, if_version?}`, `POST /doc/move`, `DELETE /doc`, `GET /doc/history`, `POST /folder`, `DELETE /folder` | `notes-tasks_docs`, `_doc`, `_doc_save`, `_doc_move`, `_doc_delete` (confirm), `_doc_history`, `_folder_create`, `_folder_delete` | `notes-tasks/doc/<path>` |
| Adopt a Voice note / document into a list | `POST /items/adopt {ids, list}` | `_items_adopt` | |
| Export a list as Markdown / JSON | `GET /export.md?list=`, `GET /export.json?list=` | `_export_md`, `_export_json` | |
| Import | `POST /import {$axf: todo-store@1 | amberx-notes@1, …}` | `_import` | |
| Settings → Plugins → Notes & tasks: types editor, view prefs | `GET /types`, `PUT /types`, `GET /prefs`, `PUT /prefs` | `_types`, `_types_save`, `_prefs`, `_prefs_save` | `console_settings` `plugins/notes-tasks` |
| Live updates | `GET /events` (SSE; `skip` in plugin-commands) | – | – |

Web actions registered on the runtime (so `console_action` and search reach them): `notes-tasks.new-note`,
`.new-todo`, `.new-task`, `.new-list`, `.quick-add`, `.view.tree`, `.view.grid`, `.group.<lists|kind|status|priority|tag|due>`,
`.tab.<today|upcoming|todo|all|done>`, `.export`. Nav badge counter `tasks.today` (Today + overdue, hidden at 0).
Reads: `info`, `data`, `data-file` come free; the store itself is on the hub, so `data` lists the import marker files
only.

## UI (the Opus phase; every colour, size, font, radius from `--fx-*` tokens, framework controls only)

- Nav → Notes & tasks (tabable `notes-tasks`, label "Notes", icon `list`). Left pane: the tree (TreeView): Inbox,
  Brett's lists, Plugins, Voice notes, Documents; counts per list; drag to move. Right pane: TabGroup Today / Upcoming
  / Todo / All / Done / Notes, a toolbar (`role="toolbar"`, aria-label) with quick add, view tree / grid, group by,
  filters (kind, status, priority, tag, due), search, export, selection actions. Grid = the Todo manager's DataGrid
  with custom `showInGrid` fields; tree = AmberX's item rows with subtasks and checklists inline.
- Entry dialog `dialog:notes-tasks.item`: the kind's core parts and custom fields as the type schema says; draft save
  with warnings. Documents open in the right pane with the edit switch and conflict-safe save (409 → reload).
- Settings → Plugins → Notes & tasks: types editor (per kind: label, icon, tone, core rules, statuses, defaults,
  custom fields), view prefs, hub state, import, Install & uninstall panel.
- Phone: tree collapses to a drawer; tabs stay. Desktop and phone shots to UI Review before the PR is called ready.

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

1. **s2 (Fable, engine)** `framework/core/engines/notes-rules.mjs` + `.d.mts` from the two AmberX cores + the Todo
   manager rules; fixture `spec/fixtures/notes.json`; `spec/check-notes.mts`; AmberX cores become re-exports
   (`apps/amberx-droid/test.mjs` still green); token-control imports the engine, gen script retired; control-rules
   append (`blocked`, `fields`, `tone`, `select.project`), `schemas/control.json` + `fixtures/control.json` regenerated.
2. **s3 (server)** `server/model.py` (Python mirror replaying the fixture), `server/hub.py` (hub-table@1 over the
   data server's HTTP API with If-Match retry, mounted-file fallback), `server/docs.py` (the Notes browser store,
   moved), `server/__init__.py` routes above, import on first start, `test.py`.
3. **s4 (web)** the view, tree, tabs, grid, dialog, toolbar, actions, nav badge, SSE refresh; check-theme,
   check-controls, check-toolbars green.
4. **s5 (web)** Settings sub-tab (types editor, prefs, hub state, import, lifecycle panel); `help.json`.
5. **s6 (AmberX)** `plugins/notes` + `plugins/tasks` on the engine and the per-project folder; `POST /intent` when the
   console is reachable; `amberx-droid/test.mjs`.
6. **s7 (retire)** `todo-manager` and `notes-browser` removed through their `uninstall.mjs`; README / STATUS lines
   re-marked `<!-- axf-plugin:notes-tasks -->`; `framework/catalog/status.json`; PORTING twin line kept current;
   UI Review submission; PR says how every feature is reached (the table above).

## Known gaps, stated

- Live follow of the phone's writes is a 30 s / on-focus re-read of `head.json` through the server (SSE to the UI),
  not a push: the hub's `/data-events` follow is the lib-hubstore placeholder `axf.hubstore.live`.
- Two writers (phone via HTTP, console via HTTP) are safe through If-Match; the mounted-file fallback is last-write-wins
  and is for dev / tests only (the same risk `lib/amberx.mjs` carries today).
- A project that is archived keeps its folder on the hub; nothing deletes a store.
- Kotlin twin of the engine: deferred (PORTING.md), Android on hold.
