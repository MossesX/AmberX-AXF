# Notes and tasks (console plugin `notes-tasks`)

The one plugin for notes, to-dos and tasks. The Dev Console and AmberX load this same folder (`targets` in
`plugin.json`), so there is no per-app copy of the code or the data.

## One store

Lists and items live on axHub: hub project `amberx-axf`, folder `amberx-notes/`, tables `lists` and `items`
(amberx-notes@1, `web/notes/core.ts`). Both apps read and write it directly through lib-hubstore. control@1
(`amberx.items`, `amberx.lists`) and voice intents change the same rows.

Shown alongside, read-only, never copied into the store:

- **Voice notes** (hub folder `voice-notes/`).
- **Claude files** (`/projects/_shared/_claude/notes`): sessions, axHub and claude-sync write those Markdown files, so
  they stay their own home. This plugin's server reads them through `axf.notes@1`. Rename, move and folders are on the
  console's Claude files page (plugin `notes-browser`). Tap **Copy to list** on one to make an editable note.

## Live sync

While a page is visible, `watchHeads` in `web/notes/store.ts` checks both table heads every 3 s and reloads when one
moved, so a change in one app shows in the other without a reload. Focus, coming back online and a 30 s timer also
reload. Offline changes queue on the device and are written when the hub is back.

## What differs per app

Only `@console/notesHost`: the console's `apps/console-web/src/notesHost.ts`, AmberX's
`apps/amberx-droid/src/console/notesHost.ts` (nav group, hub address, sign-in, the AI summarizer, per-plugin lists).
AmberX's own plugins (voice, dictation, commands, web, ai) import the store as `@plugin/notes-tasks/web/notes/store`.

## Removing it

AmberX's voice, dictation, commands, web and ai plugins build on this plugin's store (`@plugin/notes-tasks/...`), and
Token control's `gen-amberx-core.mjs` generates from its core. Uninstalling it leaves the data on the hub, but AmberX
stops building until those imports go too.

## Migration

`server/migrate.py` runs once when the console starts. It backs up the Todo manager's `store.json` and the hub tables
to `<dataDir>/backup/<stamp>/`, then adds the Todo manager's lists and entries to the store. It only adds rows, so it
is safe to repeat and never overwrites an edit; the old `store.json` stays where it was. What an item has no field for
goes into its tags (`blocked`, `urgent`) or its text (custom fields). `GET /migration` shows what it did, `POST
/migration` runs it again. `AXF_NOTES_TASKS_MIGRATE=off` turns the automatic run off.

## Tests

`python3 apps/console-web/plugins/notes-tasks/test.py` and `npx -y tsx apps/amberx-droid/test.mjs`.
