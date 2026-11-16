# Todo manager — todo-tree@1

Build `fable-rebuild-to-do-manager-unlimited` (Fable, Nov 16 2026). This document and `schema/todo-tree.json` are the
contract the server, the web UI, the MCP tools, the CLI and AmberX voice all build to. The engine that enforces it is
`core/todo-tree.mjs` (pure, no IO); export lives in `core/export.mjs`; the one-time migration in `core/migrate.mjs`.

Brett, Nov 16 2026: "Unlimited nesting: lists inside lists, notes inside lists, lists inside notes. Rebuild the whole
thing, make it professional. I need context menu. I need it all voice controlled. Everything."

## 1. One tree

There is one thing: the **node**. A list, a note, a to-do and a task are nodes that differ only in `kind`. Any node may
hold any node (`parentId`), to any depth. There is no rule about which kind may hold which, and no depth limit: the
engine walks iteratively and only stops at a corruption guard of 10 000 levels, reported as a store warning, never as
a user rule.

```
Trip to Lisbon                 note    "Flights booked, hotel near Alfama"
├─ Packing                     list
│  ├─ Passport                 todo    done
│  └─ Chargers                 todo
│     └─ Which cables          note    "USB-C ×2, the watch one"
├─ Bookings                    task    doing, due 2026-11-20
│  └─ Dinner Friday            task    high
└─ Ideas                       list
   └─ Day trips                list
      └─ Sintra                note
         └─ Things to see      list
            └─ Pena palace     todo
```

## 2. The document

```json
{ "$axf": "todo-tree@1", "project": "amberx-axf", "nodes": { "<id>": node }, "trash": [], "ops": [], "seq": 0, "meta": {} }
```

One file per project (projects@1), as before: base project `<dataDir>/store.json`, any other project
`<dataDir>/projects/<id>/store.json`. `dataDir` is `.axf-console/plugins/todo-manager` (`AXF_TODO_DIR` overrides).
Written atomically, 0600, by the server only.

### Node

| Field | Type | Rule |
|---|---|---|
| `id` | string | migrated nodes keep their todo-store@1 integer as a string (`"4"`); new nodes `n-<base36 time><4 random>`; the prefix means nothing |
| `kind` | `list` · `note` · `todo` · `task` · open slot | an unknown kind is treated like a note (no tick box). **Checkable** kinds: `todo`, `task` |
| `parentId` | id or `null` | `null` = the root. Refused: a parent that is the node itself or one of its descendants |
| `order` | order key | base-62 fraction string, compared as a plain string (§3) |
| `title` | ≤ 200 | required; empty becomes `Untitled <kind>` on create, is refused on rename |
| `body` | ≤ 50 000 | Markdown; absent = `''` |
| `done` | boolean | the tick. `true` ⇔ `status === 'done'` |
| `doneAt` | ms or null | set when `done` becomes true, cleared when it becomes false |
| `status` | `open` · `doing` · `blocked` · `done` | optional detail; absent = `open`. Setting it keeps `done` in step and vice versa |
| `due` | `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` or null | local day, optional time |
| `priority` | `none` · `low` · `normal` · `high` · `urgent` | absent = `normal` |
| `collapsed` | boolean | children folded in the tree; shared view state |
| `tags` | string[] ≤ 20 | lower-case, trimmed, unique |
| `tone`, `icon` | tone enum, icon id | optional on every kind (was list-only). The UI maps tone to `--fx-*` tokens, never a literal colour |
| `fields` | object | custom fields from todo-store@1, opaque to the engine, kept as they are |
| `source` | `voice` · `typed` · `ai` · `import` · `console` · `api` | optional |
| `createdAt`, `updatedAt` | ms | always present |

Computed by the engine, never stored: `depth`, `path` (ancestor ids), `breadcrumbs` (ancestor titles), `children`,
and the roll-ups `count` (descendants), `checkable` / `checked` (checkable descendants and how many are done),
`overdue` (open checkable descendants due before today).

### Invariants (checked by `validate`)

1. Every `parentId` names a live node or is `null`. An orphan is reported and shown under the root until moved.
2. No cycles. A chain that loops (two writers raced) is reported; the engine breaks it on read by re-rooting the first
   node of the loop, and says so in `warnings`.
3. Sibling order keys are unique within a parent. Duplicates are reported and resolved on read by appending in id order.
4. `done === (status === 'done')`.
5. Ids are unique (a map, so by construction).

## 3. Order keys

Siblings sort by `order`, a fractional index over `0-9A-Za-z` (base 62, ASCII order), the scheme of Figma's and
rocicorp's fractional-indexing: an integer part whose first letter says how long it is (`a` + 1 digit … `z` + 26 digits
for positive ranks, `Z` + 1 … `A` + 26 for negative) followed by an optional fraction with no trailing `0`. Plain
string comparison gives the right order, and `orderBetween(a, b)` returns a key strictly between any two keys (`a =
null` means the start, `b = null` means the end) without touching any other sibling. The first key is `a0`; appending
increments the integer (`a1` … `az`, `b00` …), so keys stay two or three characters in practice; the fraction grows by
one character only when a key is squeezed between two neighbours one digit apart. The engine renumbers a parent's
children (`renumber`) only when a key would pass 200 characters.

Ties are impossible after `validate`; where two equal keys are found (hand-edited file) they resolve by id.

## 4. Paths

Voice and the CLI name a node by title path: `Groceries > Weekend` (separators `>`, `/`, `›`, `»` or ` then `, each
with any spacing). `resolvePath(doc, path, { from })`:

- each segment matches a child of the current node by title, case-insensitive, whitespace folded: exact match first,
  then a unique prefix, then a unique "contains";
- the first segment is looked up from `from` when given (the node the user is looking at), else the root; when the root
  has no match the whole tree is searched for a unique title;
- the result is `{ id }`, or `{ ambiguous: [{ id, path }] }` (several matches: the caller asks back with the
  candidates), or `{ notFound: segment, at: id|null }`.

`pathOf(doc, id)` is the inverse: `"Trip to Lisbon > Packing > Chargers"`.

## 5. Operations

Every operation is a pure function `(doc, …args, ctx?) → { doc, result, op }` that returns a new document (the old
one is untouched), the operation's result, and the op-log entry it appended. `ctx` is `{ now, by, cascade }`. Every
operation refuses bad input with an `TodoError` carrying `code` and an HTTP-shaped `status` (400 / 404 / 409) so the
server can pass it straight through.

| Operation | Signature | Rule |
|---|---|---|
| create | `create(doc, { kind, title, parentId?, before?, after?, body?, due?, priority?, tags?, … })` | `parentId` null = root; `before` / `after` = sibling to sit next to, else last. Returns the node |
| rename | `rename(doc, id, title)` | title trimmed, non-empty |
| edit | `edit(doc, id, patch)` | any of body, due, priority, status, tags, tone, icon, fields, kind. `done` through `status` or `complete`. Changing `kind` keeps every field |
| move | `move(doc, id, { parentId, before?, after? })` | whole subtree moves (one row changes). Refused (409 `cycle`) when `parentId` is the node or a descendant |
| reorder | `reorder(doc, parentId, ids)` | the given ids take the front of the parent's order in this sequence; others keep their relative order after them |
| duplicate | `duplicate(doc, id, { parentId?, after? })` | copies the subtree with new ids, titles unchanged except the root gets ` (copy)`, `done` kept, dates now. Placed after the original by default |
| complete | `complete(doc, id, done, { cascade })` | §6 |
| delete | `delete(doc, id)` | moves the subtree to `trash`; returns `{ token, count }`. The token undoes it |
| restore | `restore(doc, token)` | puts a trashed subtree back where it was (root when the parent is gone); 404 `unknown-token`, 409 `id-taken` if an id now exists |
| collapse | `collapse(doc, id, collapsed)` / `collapseAll(doc, collapsed, { under })` | view state |
| undo | `undo(doc, token?)` | reverts the op with that token (the latest when absent) by putting every touched node back to its `before`. Refused 409 `stale` when a touched node changed after that op. Undoing a delete also drops the trash entry; undoing a restore puts it back |
| bulk | `bulk(doc, ids, action, args)` | `delete` · `move` · `complete` · `duplicate` · `edit` · `collapse` applied to each root in `ids` (descendants of another selected id are skipped). One op, one undo |

Reads (no doc change): `node(doc, id)`, `children(doc, id|null)`, `descendants(doc, id)`, `ancestors(doc, id)`,
`breadcrumbs(doc, id)`, `depth(doc, id)`, `tree(doc, { root, depth, showDone })` (nested view with roll-ups),
`flat(doc, { root, respectCollapsed })` (what a tree view draws), `search(doc, { q, kind, done, tag, due, under })`,
`rollups(doc)` (one post-order pass for every node), `pathOf`, `resolvePath`, `validate`, `stats`.

## 6. Completion and the cascade rule

`done` is meaningful on every node but only `todo` and `task` are **checkable** (they count towards progress and get a
tick box). A list or note shows the progress of its checkable descendants (`checked / checkable`).

`complete(doc, id, done, { cascade })`, `cascade` ∈ `none` · `down` · `up` · `both`; the default is the plugin setting
`completion.cascade` (shipped default **`down`**):

- `none`: only the node.
- `down`: ticking also ticks every open checkable descendant; un-ticking changes the node only.
- `up`: after the change, walk up: a checkable ancestor whose checkable children are all done becomes done; an ancestor
  that is done while one of its checkable children is open becomes open again.
- `both`: `down` then `up`.

Every node that changes is in the op's `touched`, so one undo reverts the whole cascade.

## 7. Trash, op log and undo

- **Trash** holds deleted subtrees (root + descendants, exactly as they were, plus where the root sat) for up to 200
  entries; the oldest fall off. `delete` returns the entry's `token`; the UI shows "Deleted *Packing* and 3 inside ·
  Undo" and voice says it. Restore is by token.
- **Op log** (`ops`): every operation appends `{ seq, token, at, op, nodeId, args, touched: [{ id, before, after }], by }`.
  `touched` is complete: replaying `after` over a doc reproduces the op, replaying `before` reverts it. The log keeps the
  last 1 000 ops; `seq` keeps counting.
- **Undo** is generic: any op can be undone while none of its touched nodes has changed since (`updatedAt` and identity
  compared against `after`). Undo is itself an op (`op: 'undo'`, `undoes: <token>`), so redo is "undo the undo".

## 8. Export

`core/export.mjs`: `toMarkdown(doc, rootId|null, { showDone })` renders a subtree as nested Markdown: the root as a
heading, lists as headings down to `###` then bold bullets, to-dos and tasks as `- [ ]` / `- [x]` with due, priority
and tags in italics, notes as `•` bullets with their body indented under them, children indented two spaces per level
to any depth. `toJSON(doc, rootId|null)` returns `{ "$axf": "todo-tree@1", "export": true, "rootId", "nodes": [...] }`
with the subtree's nodes in depth-first order, importable by `create`-replay later.

## 9. Migration from todo-store@1 (`core/migrate.mjs`)

Runs once per store on the server's first load of a todo-store@1 file, and by hand (`migrate --dry-run`). It backs
the old file up first (`store.json.todo-store-v1.<timestamp>.bak`, same folder, 0600), is idempotent (a todo-tree@1
file is returned unchanged; a second run on the same todo-store@1 file produces the same nodes), and `dryRun` reports
counts and warnings without writing.

| todo-store@1 | todo-tree@1 |
|---|---|
| list `id`, `parentId`, `title`, `tone`, `icon`, `sortOrder`, `createdAt`, `updatedAt` | node `id: String(id)`, `kind: list`, `parentId: String(parentId)` or null, `order` from `sortOrder` rank among siblings, tone / icon kept when set |
| entry `id`, `listId`, `parentId`, `kind`, `title`, `body`, `tags`, `fields`, `sortOrder`, dates | node `id: String(id)`, `kind` as is, `parentId: String(parentId ?? listId)`, `body`, `tags`, `fields` kept when non-empty |
| `status` `open` · `in_progress` · `blocked` · `done` | `status` `open` · `doing` · `blocked` · `done`; `done = status === 'done'`; `doneAt = completedAt` |
| `priority` `low` · `normal` · `high` · `urgent` | the same value |
| `dueAt` ms | `due` `YYYY-MM-DD` (local day; the time is kept as `THH:mm` when it is not midnight) |
| `checklist[]` `{ id, text, done }` | child nodes `kind: todo`, id `<entry id>.<item id>`, in checklist order, done kept |
| `types` | `meta.legacyTypes`, untouched |
| `nextId` | dropped; ids are strings now |
| `source` url custom field | kept in `fields.source` |

Nothing is dropped: an entry whose list is missing becomes a root node with a warning; a list whose parent is missing
too. Counts (`lists`, `entries`, `checklistItems`, `nodes`) come back for the log.

### Mapping to notes-tasks@1 (PRs #527 / #545, design only)

todo-tree@1 is deliberately one-to-one with the `item` row of `notes-tasks@1` so the two can be merged without data
loss: `kind` ↔ `look`, `parentId` ↔ `parent` (`null` ↔ `''`), `order` (string) ↔ `order` (number: rank), `body` ↔
`text`, `status doing` ↔ `doing`, `priority none|low|normal|high|urgent` ↔ `0|1|0|2|3`, `due` ↔ `due`, ms dates ↔
ISO, `doneAt` ↔ `doneAt`, `collapsed`, `tags`, `tone`, `icon`, `fields` ↔ the same. Nothing in notes-tasks changes in
this build.

## 10. Reaching everything (the Opus phase builds to these names)

Every operation above is one REST route under `/api/plugins/todo-manager/`, one plugin-commands tool
`todo_<op>` (`todo_tree`, `todo_get`, `todo_create`, `todo_rename`, `todo_edit`, `todo_duplicate`, `todo_move`,
`todo_reorder`, `todo_complete`, `todo_delete`, `todo_restore`, `todo_undo`, `todo_export`, `todo_collapse`,
`todo_search`, `todo_migrate`), one CLI verb (`todo.mjs tree | add <kind> <title> --in <path> | rename | edit | move |
dup | done | undone | rm | restore | undo | export | migrate --dry-run`), and one voice intent with path phrases ("make a
list called X inside Y", "add a note to Y", "move X into Z", "check off X", "delete X", "undo"). Parents are addressed
by id **or** path everywhere (`{ parent: "Groceries > Weekend" }`). Deep links: `todo-manager` (the view),
`todo-manager/node/<id>` (a node with its ancestors expanded), `todo-manager/path/<url-encoded path>`.

## 11. Limits and expansion

| Limit | Value |
|---|---|
| nodes per store | 50 000 |
| title / body | 200 / 50 000 characters |
| tags per node | 20 |
| trash entries / op log | 200 / 1 000 |
| depth | unlimited (corruption guard 10 000) |
| order key length before renumber | 200 |

Open slots: `kind` is a pattern, not a closed enum, so a later `idea` or `bug` kind reads today; `fields` is opaque;
`meta` takes any key; `source` and `by` record where a change came from; `ops.args` keeps the call as made. A Kotlin
twin of the engine is deferred (PORTING.md); Android is on hold.
