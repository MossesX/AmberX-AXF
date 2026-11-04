# Notes (console plugin `notes-browser`)

Brett's notes in one place, from two sources, in two views.

## Sources

- **AmberX** (default): the AmberX app's notes (`amberx.items`, kind `note`), read and changed through the
  `control@1` capability (Token control), so the same notes show on every device. Edit, pin, move to a list, delete
  (control@1's confirm token).
- **Claude files**: the hub's shared Claude notes, `/projects/_shared/_claude/notes` (Markdown in folders). New note,
  new folder, rename, move, conflict-safe saves (`if_version`), delete with the hub's history kept.

## Views (build notes-views, Nov 4 2026)

- **Classic**: the notes on the left (grouped by folder or list), the open note on the right.
- **Grid**: one row per note: title, kind, list, tags, priority, due, updated, created, section count, length.
  Click a header to sort; right-click a header to hide or show columns (kept on this device); filter by kind, list
  and tag; search. Tap a row to expand it to the whole note with Edit / Open in Classic / Pin / Move / Delete;
  several rows can be open at once. On a phone the rows are cards.

Every note body renders through the framework's **FoldSections** (`framework/react/components/FoldSections.tsx`):
Markdown headings and ALL-CAPS lines that open a paragraph (`JUST MERGED (Nov 4)`) become fold headers with a
chevron and an item count; Expand all / Collapse all; the fold state is kept per note on this device; search words
open the sections that hold them and are marked.

## Switching

- the page's toolbar (toolbar asset `notes-views`, shipped in `web/notes-views.toolbar.json`)
- View → Notes view → Classic / Grid, and the page's right-click menu
- actions `notes-browser.view:<classic|grid|toggle>` and `notes-browser.source:<amberx|claude|toggle>`: voice,
  console MCP `console_action` (`{"action": "notes-browser.view", "args": ["grid"]}`), control@1 `console.actions`
- Settings → Plugins → Notes → Views: view and source (per device), ALL-CAPS headers on/off, start collapsed

## Server routes (`/api/plugins/notes-browser/`)

See `server/__init__.py`: `notes`, `note`, `history`, `move`, `folder` (Claude files; `notes?content=1` adds each
note's text) and `amberx`, `amberx/item`, `amberx/act` (AmberX through control@1). Tests: `python3 test.py`,
`npx -y tsx framework/spec/check-fold-sections.mts`.
