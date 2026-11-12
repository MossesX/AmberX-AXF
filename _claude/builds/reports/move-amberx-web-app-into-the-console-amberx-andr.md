# Move AmberX web app into the console; the phone app reads the console

Build `move-amberx-web-app-into-the-console-amberx-andr`, phase 4 (Opus), steps s3–s14. Branch
`claude/move-amberx-web-app-into-the-console-amberx-andr`, PR #528. Contract: `docs/contracts/amberx-console-api.md`
(amberx-console-api@1; each step adds a "Built in sN" note under its section).

Brett (Nov 12 2026): "Now what we're gonna end up doing is just moving everything over the console and making AmberX
app read the console instead of AmberX." / "I want to get rid of the AmberX app and make a console app."

## What landed

| Step | Feature | Where | Deep link | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|---|---|
| s3 | Notes screen | plugin `amberx-notes` | `amberx-notes.focus:<list \| item:id \| search:words \| new>` | `/api/plugins/amberx-notes/state\|settings`; items on `/api/control/amberx.items` | `amberx-notes_*`, `amberx_*`, `control_*` | `axf amberx-notes …`, `axf note …` | "open notes", "new note", "read my inbox" |
| s4 | To-dos | plugin `amberx-tasks` | `amberx-tasks.focus:<today \| upcoming \| todo \| all \| done \| item:id \| new>` | `/api/plugins/amberx-tasks/state\|items\|add\|complete\|reorder\|remove\|settings` | `amberx-tasks_*` | `axf amberx-tasks …`, `axf todo …` | "what's due today", "show todos", "new todo" |
| s5 | Lists | plugin `amberx-lists` | `amberx-lists.focus:<list id \| new>` | `/api/plugins/amberx-lists/state\|list\|export\|lists/*\|items/*\|settings` | `amberx-lists_*` | `axf amberx-lists …`, `axf list …` | "open lists", "make a new list" |
| s6 | Approvals page, feed, comments | plugin `approvals-banner` | `approvals.focus:<id>` (view `approvals`) | `pending?since=`, `approval`, `comments`, `comment`, `settings` | `approvals-banner_*` (decide never) | `axf approvals-banner …` | "open the approvals page", "check approvals" |
| s7 | Recorder on the console | plugin `output-recorder` | `output-recorder.focus:<id>` | `recordings` (PUT parts / index, GET, audio with Range, DELETE two-step, transcribe, act/start\|stop), `device/status`, `settings` | `output-recorder_*` | `axf output-recorder …` | "play the last recording", "show my recordings" |
| s8 | open_url | plugin `console-commands` | `console_settings("console-commands")` | `open-url`, `open-url/{id}/cancel`, phone pick-up + answer, `settings` | `console-commands_open-url*` | `axf console-commands open-url …` | through Amber (MCP) |
| s9 | Notifications history | `server/alerts.py` + plugin `alerts-bell` | `alerts-history.focus:<id \| device:name>` | `/api/alerts?device=&since=`, `/api/alerts/history`, `/api/alerts/tapped`; plugin `feed\|history\|raise\|read\|dismiss\|resolve` | `alerts-bell_*` | `axf alerts-bell …` | "notification history", "mark them read" |
| s10 | AmberX settings | plugin `amberx-settings` (tab `amberx`) | `amberx-settings.focus:<key>` | `settings`, `settings/{key}`, `reset`, `document` (ETag) | `amberx-settings_*` | `axf amberx-settings set voice.lang en-GB` | "open amberx settings" |
| s11 | Old addresses | `apps/amberx-droid/server/forward.py` | – | `GET /api/forward/log` (AmberX server) | – | `python forward.py summary\|table` | – |
| s12 | Console app | `apps/amberx-droid` shell | – | console routes above | – | – | – |
| s13 | Backend switch | `ConsoleBackend.java` + setting `backend` | `amberx-settings.focus:backend` | `PUT /api/plugins/amberx-settings/settings/backend` | `amberx-settings_set` | `axf amberx-settings set backend amberx-web` | "switch the phone back to amberx", "switch the phone to the console" |

## Decisions (said here because nobody was watching)

- **Folders.** The brief's read-first paths (`apps/amberx-web/…`, `apps/console-web/api/`, `apps/amberx-android/…`) do not
  exist. The AmberX web app is `apps/amberx-droid` (server in `server/`, Android shell in `android/`). New console screens
  are console plugins; to-dos are `amberx-tasks` (the contract's deep-link name). Approvals, recorder, open_url and
  notifications extend the plugins that already owned them instead of new `amberx-*` copies.
- **Notes data stays put.** Notes, to-dos and lists were already control@1 targets over the hub tables; the screens use
  them through the `control@1` capability service, so every path shares one set of rules and confirm tokens.
- **Settings are plugin commands, not a control@1 target.** `amberx.settings` as a control@1 target changes the control
  engine and schema (Fable, with a Kotlin twin). Served by the `amberx-settings` plugin on the same keys; the target is a
  follow-up.
- **Auto-approve settings are person-only.** `monitor.autoApprove*` change only from a signed-in admin browser (403 for
  the token): a session must not be able to make its own calls approve themselves.
- **Approval comments stay on the console.** axHub has no comment field; comments never decide.
- **Forwarding changes nothing by default.** The console has shape-compatible routes only for console plugins, Molly and
  the walkthrough re-voice; the AI routes wait for an `amberx-ai` plugin, walkthrough media for a console media route,
  the approvals relay and decide must stay with the browser's own hub session. Each is listed with its reason, logged,
  and `AMBERX_FORWARD_PAGES=redirect` sends old pages to the console.
- **The AmberX shell becomes the Console app.** The Android hold excepts the AmberX shell, so s12 is done there (same
  package, name "Console", loads the console); `apps/console` (the native console app) stays on hold.

## Tests

| Suite | Result |
|---|---|
| `node apps/console-web/scripts/amberx-parity.test.mjs` (new, CI) | 258/258: every feature's REST / MCP / CLI form and deep link; decide not a command; control@1 CLI ↔ runner round trip |
| plugin `test.py`: amberx-notes, amberx-tasks, amberx-lists, amberx-settings (new), output-recorder (new), approvals-banner (80), alerts-bell (58) | all pass |
| `server/test_console_commands.py` (open_url added) | 127 checks pass |
| `server/test_alerts.py` (history, since, tapped added) | pass |
| `apps/amberx-droid/server/test_server.py` (forwarding added) | 182 passed |
| `npx tsx apps/amberx-droid/test.mjs` (shell config follows the Console app) | 2336/2336 |
| `migrations/amberx-import/test_migrate.py`; `migrate.py apply --check` | pass; dry run: ai 2 profiles, walkthrough 37 files to move, notes and settings in place, approvals on axHub, notifications empty; nothing written |
| `tsc --noEmit` (console-web), check-theme, check-controls, check-toolbars, plugin-commands check, check-plugin-pages | clean |
| Android unit tests (`ConsoleBackendTest`, new) | **not run here** (no JDK / Android SDK on this VPS); CI `:app:testDebugUnitTest` runs them |

## Not done / follow-ups

- **UI Review:** no desktop / phone screenshots taken in this session (no scratch console with the new plugins built);
  the PR stays draft until they are in UI Review.
- **Android build not verified locally:** the Java (ConsoleBackend, MainActivity config, WatchService, uploader,
  AmberxNative backend methods) compiles only in CI.
- **Still on old paths in the phone app:** the approvals feed (native straight to axHub), the AXPP link (recorder start /
  stop and open_url fallback), and voice inside the console page (the AmberX voice registry is only in the AmberX page).
- **`amberx-ai` plugin** (contract C13–C18) and the console's walkthrough media routes: until they exist the AI and
  walkthrough addresses stay on the AmberX server.
- **control@1 `amberx.settings`** target (Fable).
