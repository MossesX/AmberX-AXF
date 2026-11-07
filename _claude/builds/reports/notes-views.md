# Notes views (build `notes-views`, Opus, Nov 4 2026)

**What Brett said (voice, Nov 4 2026):** "Make the sections in your note collapsible." (Asked: just this note or every
note?) "Yeah, make a couple of views. One view is the same way it is now, but with collapsible sections, and another
view is the notes in a grid with expandable rows that shows the note."

Agent: Sully (`AXF_AGENT=sully`). Branch `claude/notes-views`. Test case: Amber's note *Features that landed:
Nov 3-4 2026* (AmberX item `n-mw2msj0q03x`, sections JUST MERGED / NOV 4 (EARLIER) / OVERNIGHT BATCH).

## What changed

**Framework (reusable):**
- `framework/react/components/FoldSections.tsx` + `foldParse.ts` (pure, no React): a note or document body as
  collapsible sections. Markdown headings `#`…`######` and ALL-CAPS lines that open a paragraph become fold headers
  with a chevron and an item count (list items under the header, else paragraphs, else sub-sections); an outline,
  so a `###` nests in its `##` and a caps line nests in any Markdown heading; fenced code is never split; a lone
  shouted line with nothing under it stays text. Expand all / Collapse all toolbar; fold state per device
  (`storageKey`, localStorage `axf.fold:<key>`); search words open the sections holding them and are marked with the
  CSS Custom Highlight API (`::highlight(axf-fold-hit)`, the Markdown DOM is never rewritten). Keyboard + screen
  readers: each header is a button with `aria-expanded` / `aria-controls`, bodies are labelled regions.
- `.fx-folds` / `.fx-fold*` in `framework/ui/axf.css`, tokens only. Exported from `framework/react` (+ console's
  baked `src/axf`). Help entries for Expand all / Collapse all (framework help pack, re-baked into every app).
- Test `framework/spec/check-fold-sections.mts` (8 checks, wired into CI next to check-tapconfirm).

**Console Notes (`apps/console-web/plugins/notes-browser`, 0.1.0 → 0.2.0):**
- Two sources: **AmberX** (new, default; `amberx.items` kind `note` through the `control@1` capability, the caller's
  own grants) and **Claude files** (as before). New server routes `GET /amberx`, `PUT /amberx/item`,
  `POST /amberx/act` (pin / star / move / done / undone), `DELETE /amberx/item` (control@1 confirm token round trip);
  `GET /notes?content=1` adds each note's text so the grid can count sections.
- **Classic** view = today's layout; the note body is now FoldSections.
- **Grid** view = framework DataGrid: title, kind, list, tags, priority, due, updated, created, sections, length;
  header click sorts, header right-click hides/shows columns (kept per device; created / priority / due hidden by
  default), kind / list / tag filters + search; tapping a row expands it to the full note (same sections) with Edit /
  Open in Classic / Pin / Move / Delete; many rows open at once; *Close all rows*; phone = cards.
- Switcher everywhere: the page's toolbar asset `notes-views` (shipped in the plugin, registered at load), View →
  Notes view, the page's right-click menu, actions `notes-browser.view:<classic|grid|toggle>` and
  `notes-browser.source:<amberx|claude|toggle>` (voice, MCP `console_action`, control@1 `console.actions`).
  Check marks bind `counter:notes-browser.view:<id>` (resolveChecked only reads booleans/counters).
- Settings → Plugins → Notes → **Views** (framework settings): View and Notes from (per device), ALL-CAPS lines are
  section headers (on), Start with sections collapsed (off).
- README in the plugin folder; 15 help entries; server test +13 checks (AmberX routes with a fake control@1, content
  listing).

## Checks (local)

`tsc --noEmit` (console) clean · check-theme ✓ · check-controls ✓ · check-toolbars ✓ · plugin-lifecycle notes-browser ✓
· help-coverage ratchet ✓ (framework 123/123, console 1412/1412) · check-help ✓ · check-fold-sections 8 ✓ ·
notes-browser test.py all passed · check-plugin-commands ✓ · plugin-commands runner ✓ · plugins.mjs --check ✓ ·
menu-reach ✓ · shared-assets check ✓ · console `npm run build` ✓.

## Screenshots

`notes-views/shots/` — desktop + phone: `*-classic`, `*-classic-folded` (NOV 4 folded), `*-classic-search`
("gizmo": the folded section reopens, hits marked), `*-grid`, `*-grid-expanded`. Sent to UI Review → Screenshots
(non-blocking).

## Follow-ups (not built here)

- **AmberX app's Notes screen** (`apps/amberx-droid/src/plugins/notes/web`) doesn't share this component: it shows
  note cards with a two-line snippet and edits in a dialog, and its baked framework (`src/axf`) is behind (rebake
  status: stale). Follow-up: re-bake AmberX, then render note bodies with `FoldSections` in its item view and add the
  Grid view there. Recorded on the build as a note, not built (keeps this build console-only).
- Plan Studio and MD Studio can adopt `FoldSections` for long plan / doc bodies.
- Toolbar check marks for choice settings: `resolveChecked` has no `setting:<key>=<value>` form; counters stand in.
  A `=value` form would be an appmenu engine change (cross-port, Fable).
