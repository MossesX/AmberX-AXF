# Remove the console's own Notes manager; console uses AmberX's notes/to-do manager

Build `remove-the-console-s-own-notes-manager-console-u` · Opus · branch `claude/remove-the-console-s-own-notes-manager-console-u`

Brett (verbatim): "Delete the console with no manager. That's whack. Open the Amber X's no manager."

## What changed
- **Console Notes = AmberX's Notes.** New plugin `apps/console-web/plugins/amberx-notes`: view `notes` (Console › Notes, Plugins › Notes, nav, tabable) frames AmberX's own Notes page as an embed@1 view page (`?axf-embed=console&axf-embed-page=view:notes`): AmberX's Inbox / Lists / Notes / Pinned / Search, item editor, list manager and export, no AmberX chrome. Same amberx.items / amberx.lists store on axHub. Reload and Open in AmberX buttons; setting `amberx-notes.url` (https only, default https://amberx.amberxai.com).
- **Deep links.** Console action `notes.focus:<focus>` (what `console_open notes` + `focus` calls): `item:<id>` opens that note's editor on its list, `list:<id>`, `search:<text>`, `add`, or a tab name; `notes.open`. AmberX reads the same focus from `?notes=<focus>` on load and has the same `notes.focus` action (`ui.ts parseFocus`).
- **AmberX server** `frame-ancestors` now allows `https://console.amberxai.com` (was Molly only).
- **Console Todo manager deleted** (`plugins/todo-manager`, its Console › Todos entry, help entry, doc lines). Migration first: `amberx-notes/migrate.mjs` moves a todo-store@1 file into amberx.items through control@1 (lists nested under "Console todos", kinds / status / priority / due / tags / checklist kept, subtasks linked). Live store (`/opt/axf/.axf-console/plugins/todo-manager/store.json`) held one empty list and 0 entries: dry run "would move 0 of 0", nothing to move. The file is left on disk.
- **notes-browser** (hub Claude files: handoffs, logs) loses its screen and menu entries so the console has one notes manager; it stays as the `axf.notes@1` service MD Studio's Notes scope uses, renamed "Claude notes".

## API parity (how each is reached)
| | Console UI | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| Open Notes / a note / list / tab | Console › Notes | console commands (`console.screens` open `notes`, focus) | `console_open notes focus=item:<id>` / `console_show` | `axf console open notes` + `axf console action notes.focus item:<id>` | AmberX "open my notes" (its own page) |
| Read / add / change / delete items and lists | AmberX's page | `/api/control` amberx.items / amberx.lists | `amberx_*` | `axf note | todo | task | list` | AmberX notes intents |
| Migrate | – | – | – | `node apps/console-web/plugins/amberx-notes/migrate.mjs [file] [--dry-run]` | – |
| Setting (AmberX address) | Settings › Plugins › Notes | console settings | `console_settings plugins/amberx-notes` | – | – |

## Checks
- `tsc --noEmit` console-web and amberx-droid: clean.
- `ci-scope light --run`: validate, tracker, project validate, builds-store verify, check-theme, check-controls, check-toolbars all green; check-chrome-assets green (baseline lowered by one).
- `plugin-lifecycle check amberx-notes`: clean. Tests: amberx-notes `test.mjs` 9/9, notes-browser `test.py` all passed, token-control 21/21, amberx server 172/172.

## Not done / gaps
- **UI Review shots not taken**: no browser (Playwright) on this VPS session, and the frame only renders once AmberX is deployed with the new frame-ancestors. Shots of Console › Notes (desktop + phone) go to UI Review after AmberX deploys.
- Android console twin: none needed (no Kotlin notes screen); no Kotlin work.
- Voice notes plugin page is untouched (it is the voice pusher setup; AmberX's Notes already lists Voice notes read-only).
