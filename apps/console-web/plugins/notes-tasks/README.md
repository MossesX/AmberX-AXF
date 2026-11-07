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

## Calendar

Day, week, month and agenda views, weekly schedules, and every task or to-do with a due date, in the console and AmberX
(`web/calendar/`). Colour-coded calendars, a now-line, a mini-month and a plain-English quick-add bar: `gym every Mon Wed
6pm`, `dentist tomorrow 3pm for 45m at Main St`, `lunch Friday noon #work`.

- **Store:** hub folder `amberx-calendar/`, tables `calendars`, `events`, `schedules`, `layouts` (written by the apps and
  by REST) and `replies`, `mail` (written only by the console server, so a guest's answer can't be lost to an app saving
  the same event). `web/calendar/store.ts` works like the notes store: queued writes, table heads watched every 3 s, but
  only while a calendar is on screen.
- **Times are wall-clock** (`2026-11-09T18:00` plus the event's `tz`), so 6pm stays 6pm over a clock change. Screens show
  them as written; the server turns them into instants for reminders and Google.
- **Drag** (`web/calendar/drag.ts`): one pointer drag finds its target under the pointer, so it works across panes and
  windows. Touch waits for a long press. A dragged repeat moves only that occurrence.
- **Weekly schedules:** named weeks of blocks, shown on every week, dates optional. Month view leaves them out so real
  events stay visible.
- **Window:** a floating window (windows@1) whose panes are dock tabs (dock@1), each with its own view, date and
  calendars. Presets, and named layouts saved on the hub.
- **Reminders:** a server round every 30 s raises a console alert (source `calendar`, one per occurrence, no browser
  needed). The alert engine sends these to the phone by default; AmberX only delivers.
- **Guests and RSVP:** invites, chasers (`rsvp.remindHours`) and "confirm you saw it" go out through axHub Gmail, one
  email per guest with their own link. Each is held for Brett's confirm by the hub's policy, and sent once. Until Gmail is
  on the hub they wait in `mail` as queued.
- **Reply page** (`server/reply.py`): `/public/notes-tasks/reply/<token>`, no login. The token is HMAC-signed for one guest
  of one event and expires two weeks after the event (90 days for a repeat). It shows title, time and place only. Opening
  it changes nothing, because mail scanners open links; only a button press counts. Limits: 60 requests per address per
  10 min, 10 bad tokens per address, 10 answers per token per hour. The key is `<dataDir>/reply-secret` (or
  `AXF_CALENDAR_REPLY_SECRET`). The page is the one screen outside the theme engines: it has no app around it, so it
  carries its own small light and dark stylesheet.
- **Plain email replies:** a reply to one of our emails (subject tag `[#<event id>]`) from a guest of that event is logged
  on it. Only a clear yes, no or maybe changes their status.
- **Google Calendar:** set `google` on a calendar (`primary`). Every 5 minutes, once the hub has the `calendar` service,
  what changed on Google comes here and what changed here goes there. A held write keeps its job id and is never re-sent;
  a denied one stays denied until the event is edited. Guests are not sent to Google, it would email them. Repeating
  events stay here: the hub's tools have no recurrence field yet. Google's repeats arrive as single occurrences.
- **Commands:** routes under `/calendar/*` become `notes-tasks_*` MCP tools and `axf notes-tasks …` by themselves. Actions
  `calendar.open:<view|today|tomorrow|date>`, `calendar.add:<plain English>`, `calendar.new`, `calendar.window`,
  `calendar.schedules`. AmberX voice: `apps/amberx-droid/src/plugins/commands/web/lib-calendar.ts`.

`/public/` is outside the sign-in wall by a Traefik router in `deploy/install-console.sh`, so the labels only change when
that installer runs. A plugin opens a page there by exporting `public_router`.

## Migration

`server/migrate.py` runs once when the console starts. It backs up the Todo manager's `store.json` and the hub tables
to `<dataDir>/backup/<stamp>/`, then adds the Todo manager's lists and entries to the store. It only adds rows, so it
is safe to repeat and never overwrites an edit; the old `store.json` stays where it was. What an item has no field for
goes into its tags (`blocked`, `urgent`) or its text (custom fields). `GET /migration` shows what it did, `POST
/migration` runs it again. `AXF_NOTES_TASKS_MIGRATE=off` turns the automatic run off.

## Tests

`python3 apps/console-web/plugins/notes-tasks/test.py` (runs `test_calendar.py` with a fake hub and `web/calendar/core.test.mts` too) and `npx -y tsx apps/amberx-droid/test.mjs`. `web/calendar/fixture.json` is what the TypeScript and Python rules must both give.
