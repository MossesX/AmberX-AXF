# notes-tasks-sync report (Nov 6 2026)

Brett: "They need to be synced. The task manager and the to-do list all needs to be synced. Make the, it needs to be a
plugin. The notes, task manager, to-do, it needs to be a plugin."

## Where the data was

| Screen | Store | What was in it |
| --- | --- | --- |
| AmberX Notes + Tasks | axHub tables, `/projects/amberx-axf/_data/amberx-notes/{lists,items}` | 27 lists, 10 items |
| Console Notes (`notes-browser`) | Markdown files, `/projects/_shared/_claude/notes` | 17 files |
| Console Todo manager | `/axf/.axf-console/plugins/todo-manager/store.json` (container) | 1 empty list, 0 entries |
| Voice notes | axHub folder `voice-notes/` | already read by AmberX, unchanged |

## What changed

- New plugin `apps/console-web/plugins/notes-tasks`, targets console + AmberX: AmberX's notes and tasks code moved
  there, not copied. `apps/amberx-droid/src/plugins/{notes,tasks}` are gone.
- One store: the axHub tables. Both apps read and write them directly, control@1 and voice change the same rows.
- Live sync: both table heads are checked every 3 s while the page is visible.
- Todo manager removed. Its one list moves into the store on the first console start after deploy, backup first
  (`.axf-console/plugins/notes-tasks/backup/`). The old `store.json` is left in place.
- Console Notes route now opens the shared page. The old page is **Claude files** (`view:claude-files`, plugin
  `notes-browser`), which keeps file rename, move and folders. `axf.notes@1` and MD Studio are unchanged.

## Decision to check: the Claude files were not moved into the store

The 17 Markdown files show on both apps under **Claude files**, read-only, read live through `axf.notes@1`. They are not
copied in. Sessions, `axhub.memory_write` and claude-sync keep writing those files, so a copy would drift, which is the
bug this build fixes. Copy to list makes an editable note from one. Editing a file itself stays on the console's Claude
files page. AmberX shows them to hub admins only (its forwarder's rule).

## Lost or changed

- Todo manager's per-kind type editor and custom field definitions are gone (no entries used them). Existing custom
  values would be kept in an item's text. Its Markdown export per list is covered by Notes → Export.
- The console has no Summarize button in the item editor (AmberX's AI connection only) and no per-plugin lists.
- AmberX Notes and Tasks menu entries moved from the axHub menu to Plugins.
- Plugin ids `ai.amberx.amberx.notes` / `.tasks` became `ai.amberx.axf.console.notes-tasks`. The old per-plugin lists stay.
- Uninstalling this plugin breaks AmberX's build: voice, dictation, commands, web and ai import its store. The
  lifecycle check passes, but this dependency is real (README → Removing it).

## Found, not touched

- `amberx-notes/items/rows-0.json` and `rows-1.json` are orphans from Nov 1: 144 rows the table no longer points at
  (`chunks: 0`, none in the live table), mostly dictation chatter. They were not restored. The backup keeps them.
- `amberx-notes/items/head.json` has mode 0620, no group read. Left as is.

## Clashes

- PR #349 (notes-views, kicked out of the queue, red) rewrites `notes-browser/web/index.tsx`, so one of the two needs a
  small conflict fix. Its Classic / Grid views are not on the shared page yet.
- `amberx-slim-down-voice-queue`: `slim.json` keeps `notes` and `tasks` under `keep.local`. Those folders are gone, so it
  must list `notes-tasks` under `keep.console` instead.

## Tests

- `notes-tasks/test.py`: 22 checks (merge, backup, repeat, chunks, vault). AmberX `test.mjs`: 2147 passing. The real console server mounts the routes and read the 17 real Claude files.
- Two-app run: console + AmberX builds on one mock hub. AmberX → console and console → AmberX both showed up with no
  reload, within the 3 s check. This used a mock hub, not the real one.
- Not tested: the live axHub (ETag exposure, rate limits) and the migration on the real data, which runs at deploy.

Foundation note: built on Opus. The store format only gained read-only mapping, so no Fable step was raised; the host
seam and migration can go in the Fable review if wanted.
