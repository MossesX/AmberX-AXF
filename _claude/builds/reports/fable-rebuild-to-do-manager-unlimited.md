# Fable rebuild: To-do manager with unlimited nesting, context menus, full voice control

Build `fable-rebuild-to-do-manager-unlimited`, Phase 1 (Fable, s1–s7: design, schema, engine, tests, migration),
branch `claude/fable-rebuild-to-do-manager-unlimited`, Nov 16 2026. Supersedes `to-do-manager-fully-voice-mcp-controlled`.

## What Brett said (verbatim)

> Use Fable to redo my to-do list and task manager. Unlimited nesting: lists inside lists, notes inside lists, lists
> inside notes. Rebuild the whole thing, make it professional. I need context menu. I need it all voice controlled.
> Everything.

Folded in from the superseded build `to-do-manager-fully-voice-mcp-controlled` (Nov 16 2026, 20:22):

> Everything needs to be voice controlled. Make a new list called New build and a note called Build.

and its note: there is no way to delete a list from its right-click / long-press context menu. Add Delete (with
confirm + undo) plus Rename, New list inside, and Move to every list's context menu, and the same for entries; all also
voice / MCP controlled. That build's s1 also asked for a CI check that fails when any plugin has REST routes with no
MCP / voice twin (carried into this build's Opus phase, s10 / s21).

## s1: design notes (the plugin as it is today)

### Files

| File | Role |
|---|---|
| `plugin.json` | plugin@1, id `ai.amberx.axf.console.todo-manager`, kind `module`, `tabable` (view `todo-manager`, label Todos), `commands: {auto: true}` (plugin-commands@1 derives MCP / CLI / control from the REST routes), lifecycle `dataDir .axf-console/plugins/todo-manager`, env `AXF_TODO_DIR`, `builtWith opus 2026-10-22` |
| `server/__init__.py` | FastAPI router at `/api/plugins/todo-manager/` |
| `server/model.py` | `Store` (todo-store@1), `validate_entry`, `sanitize_types`, `export_md`; one file per project (projects@1): base project `store.json`, others `projects/<id>/store.json` |
| `web/index.tsx` | `AxfWebLibrary`: view, nav, dialog `todo-manager.entry`, 7 runtime actions, one context menu on `axf-todo-entry`, settings tab (parent `plugins`) with the Kinds panel and the lifecycle panel |
| `web/ui.tsx` | `TodoView` (lists column + open list), `EntryEditor`, `TypesPanel`, tree / grid, selection bar |
| `web/store.ts` | client state over `pluginApi('todo-manager')` |
| `web/core.ts` | pure view rules: grouping, sorting, due buckets, `listPaths` ("Work › Backend") |
| `web/menu.ts`, `web/MoreMenu.tsx`, `web/todo-manager.css` | application menu entries, ⋯ menu, styles |
| `help.json`, `hooks.mjs`, `install.mjs`, `uninstall.mjs`, `test.py` | help asset (drafts), lifecycle hooks and checks, Python tests |

### Current data shape: todo-store@1

One JSON file, `{ "$axf": "todo-store@1", types, lists, entries, nextId }`, written atomically, 0600. Ids are
integers from one shared counter (`nextId`), so a list id never collides with an entry id.

- **list** `{ id, parentId: int|null, title ≤120, tone: ''|accent|info|success|warning|danger|neutral, icon, sortOrder, createdAt, updatedAt }`.
  Lists nest only inside lists (a child list is called a group). Max 500.
- **entry** `{ id, listId, parentId: int|null, kind: note|todo|task, title ≤200, body ≤50 000, status: open|in_progress|blocked|done,
  priority: low|normal|high|urgent, dueAt: ms|null, tags[≤20], checklist[≤200] {id, text, done}, fields {custom by key},
  sortOrder, createdAt, updatedAt, completedAt }`. Entries nest only inside entries of the same list (subtasks). Max 20 000.
- **types** per kind: label, icon, tone, `core` rules (body / status / priority / due / tags / checklist / subtasks →
  required | optional | hidden), statuses, priorities, defaults, custom `fields[]`. Edited in Settings → Plugins → Todo manager.

Nesting today is therefore two separate, shallow trees: lists→groups, and entries→subtasks, joined by `listId`. A note
cannot hold a list; a list cannot sit inside a note; a to-do's checklist is a flat array, not nodes. That is the gap
Brett named.

### Live data (VPS, `/opt/axf/.axf-console/plugins/todo-manager/`)

| Store | Lists | Entries | Notes |
|---|---|---|---|
| `store.json` (base project) | 4 (one nested) | 1 note "Build" | two lists both called "New build" (ids 2 and 3), made by the superseded build's voice test |
| `projects/test-sandbox/store.json` | 10 (groups two deep) | 10 to-dos, each with a checklist | written by `framework/cli/project-seed.mjs` (`todoLists()`), which writes todo-store@1 directly |

Both are small, so the migration (s7) is cheap and can run on first load. `project-seed.mjs` is a second writer of
todo-store@1 and moves to the new format in the Opus phase (noted for s8 / s20).

### Every entry point today

**REST** (`/api/plugins/todo-manager/…`, console token, 404 when the plugin is off):
`GET/PUT /types` · `GET /lists` · `POST /lists` · `PUT /lists/{id}` · `DELETE /lists/{id}` · `POST /lists/reorder` ·
`GET /lists/{id}/entries` · `GET /lists/{id}/export.md` · `GET /entries?q&kind&status` · `POST /entries` ·
`PUT /entries/{id}` · `DELETE /entries/{id}` · `POST /entries/bulk {ids, action: delete|move|duplicate|patch}` ·
`POST /entries/reorder`.

**MCP / CLI / control**: nothing hand-declared; `commands.auto: true` projects the routes above as
`todo-manager_<command>` tools and `axf todo-manager <command>`. There are no voice phrases, no path addressing
("Groceries > Weekend"), and no undo. This is what the superseded build set out to fix.

**Console actions** (runtime, reachable by `console_action` and search): `todo-manager.open`, `.new [kind]`, `.edit`,
`.done`, `.subtask`, `.delete`, `.reload`. Console-control inventory: `view:todo-manager`,
`view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=todo-manager`, `function:todo-manager.open`.

**Context menu**: one, on entries (`data-fx-ctx-target="axf-todo-entry"`): Edit, Done / not done, Add a subtask,
Delete (a `window.confirm`, no undo). Lists have none: rename / tone / delete live in a ⋯ `MoreMenu` on the open list
only.

**Application menu**: Plugins › Todo manager, Console › Todos. **Nav**: Plugins › Todos. **Dialog**:
`todo-manager.entry`. **Settings**: sub-tab under Settings → Plugins (Kinds of entries, Install & uninstall).

### Clash check

- `apps/console-web/plugins/notes-tasks/` (DESIGN.md + schema, PRs #527 and #545 merged, **no code**) designed
  `notes-tasks@1`: one item type nested to any depth on the hub, and proposed retiring `todo-manager` in a later
  step. Those later steps were never queued. Brett's Nov 16 request is the newer word and names the to-do manager
  itself, so this build rebuilds `todo-manager` on `todo-tree@1`. To keep the two designs mergeable later,
  todo-tree@1 keeps string ids, `parentId` + fractional `order`, `collapsed`, optional `tags` / `fields` / `tone` /
  `icon`, and documents a one-to-one mapping to notes-tasks@1 in SPEC.md. Nothing in notes-tasks is changed.
- `build-todo-sync` (PR #333, open) writes to the AmberX to-do store through control@1 `amberx.*`, not to this
  plugin. No overlap.
- `project-seed.mjs` writes todo-store@1 for the test sandbox: it must write todo-tree@1 once the server switches
  (Opus phase).

### Design decisions carried into s2–s7

1. **One tree.** Every list, note, to-do and task is a node with `parentId`; any kind inside any kind; no depth limit
   (an iterative walker with a 10 000-level corruption guard, never a user rule).
2. **Ids are strings.** Migrated nodes keep their old integer as the string (`"4"`); new nodes get `n-<base36 time><random>`.
3. **Order is a fractional key** (base-62 string, lexicographic): insert between two siblings without renumbering.
4. **Done is a boolean**, `status` stays as an optional detail for tasks (open | doing | blocked | done) and is kept in
   step with `done`. Old `in_progress` becomes `doing`.
5. **Checklists become child to-do nodes**: that is what "unlimited nesting" means for them.
6. **Trash + op log.** Delete moves a subtree to the document's trash with an undo token; every operation is journalled
   with its inverse, so undo works for any change, not only delete.
7. **Engine in JavaScript** (`core/todo-tree.mjs`, pure, no IO). The Python server (s8) calls it through a node CLI the
   way `agent-slots`, `agent-swarm` and `build-breaker` already do, so there is one implementation of the rules for
   the server, the CLI, MCP, voice and the web UI.
8. **Kotlin twin deferred** (PORTING.md line in the Opus phase); Android on hold.
