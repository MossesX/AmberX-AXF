# Build report: md-studio (Urgent)

- **Asked:** Brett, Nov 2 2026 21:30 ET (the spec in the builds store, which wins) and Nov 3 2026 voice (editor kit, Notes section, voice commands, phone first). Context view from the Nov 3 handoff.
- **Model:** Opus (every step pinned to Opus; no model switch). Assigned agent: Reel Rhonda (`reel-rhonda`), recorded here and on the build.
- **Branch:** `claude/md-studio`. Plugin folder `apps/console-web/plugins/md-studio/`.

## What was built

| Step | What | Where |
| --- | --- | --- |
| s1 | Plugin scaffold: plugin.json (plugin@1, commands auto, builtWith), install / uninstall / hooks, Settings → Plugins → MD Studio (generated settings + panels, so the level toolbar applies), help pack (41 entries + intro) | `plugin.json`, `install.mjs`, `uninstall.mjs`, `hooks.mjs`, `help.json` |
| s2 | Server: files by scope and category, read / write (if_version), kept versions, reference graph | `server/store.py`, `server/__init__.py` |
| s3 | File column: collapsible scopes → categories → files, path search + "search inside files", per-file edit switch, right-click / long-press: open, open in vertical / horizontal split, edit / lock, context view | `web/Column.tsx`, context-menu contribution in `web/index.tsx` |
| s4 | Every file is a dock@1 tab (kind `md-doc`) in the runtime's window manager: floats, splits, resizes, drops on any tab header or pane edge (DockHost from dock-engine #245) | `web/state.ts` (`openDoc`), `web/index.tsx` |
| s5 | Viewer / editor: rendered Markdown, edit mode, save, dirty marks on tab titles, conflict-safe writes (409 → reload or copy my text) | `web/Doc.tsx` |
| s6 | Reference chain as branches (column twisty, doc References strip, IDE References pane); clicking a referenced name or a .md link in the preview opens it in a split; split-direction setting (stacked on a phone) | `web/Column.tsx`, `web/Doc.tsx`, `web/state.ts` |
| s7 | Toolbar with four views: Browse (wide column, rendered), Read (slim column, wide reading), Write (column tucked, editor + live preview), IDE (dense tree, editor tabs, outline + references docked on the right through `wm.splitGroup`) | `web/model.ts` `VIEWS`, `web/index.tsx` |
| s8 | Snippets panel: 14 snippets in 6 categories; drag into an editor (native drop) or tap to insert at the last cursor | `web/model.ts` `SNIPPETS`, `web/Column.tsx` |
| s9 | Wizards: CLAUDE.md, rules, persona, threads log, skill, instructions, decision, README; filter by purpose; scope Project / Claude (pick the hub project) / Repo; create-only | `web/model.ts` `WIZARDS`, `web/Column.tsx` |
| s11 | Notes scope: the Notes Vault (`/projects/_shared/_claude/notes`) through capability `axf.notes@1` (never the notes-browser folder); hidden when the capability is absent | `server/store.py` |
| s12 | Context view (tab kind `md-chain`): a file and everything it references, tokens per part, share of the total, branch subtotals, repeats counted once, missing refs listed; **What Claude loads** (@imports only) vs **Every reference**; depth 1–6; deep link `?md-context=` | `server/store.py` `chain`, `web/Doc.tsx` `ChainPane` |
| s13 | Editor kit: Markdown toolbar (H1–H3, bold, italic, strike, code, bullet / numbered / check lists, quote, link, code block, table, divider; Ctrl+B/I/E/K/S/F), live preview split, find & replace (case option, next, replace, all), autosave (setting, default 3 s, never over a newer save), version history with view + restore (restore is itself undoable) | `web/model.ts` `TOOLS`, `web/Doc.tsx` |
| s14 | Commands declared once (plugin-commands@1 auto + named items): reads `list-files`, `read-file`, `file-history`, `file-version`, `context-chain`, `file-refs`; commands `save-file`, `restore-version` (confirm), `open-file`, `edit-file`, `open-context`, split / view / save actions → REST, MCP tools and `axf md-studio …` | `plugin.json` `commands` |
| s10 | Tests, checks, UI Review shots, PR | below |

### Scopes and ids

- `repo:<path>`: .md files in the checkout (AXF_ROOT). **Project** groups them by project manifest (root + `apps/*/project.manifest.json`), **Repo** by top folder. Skips `.git`, `node_modules`, builds, caches, baked `src/axf` copies and the builds journal; `.claude/` is allowed (skills). Kept versions in the plugin data folder (`.axf-console/plugins/md-studio/versions/`).
- `hub:<project>/<path>`: the hub's Claude files, `/projects/<project>/_claude/` for every project (`_shared` = every project; the notes folder is left to Notes). Writes use axHub's memory semantics exactly like the Notes plugin: `.axhub/claude/<p>/meta.json` attribution, `versions/<urlencoded>.json`, version = sha256[:16]. No hub mounted: the Claude scope shows the repo's synced `_claude/` copies.
- `notes:<folder>/<name>.md`: through `axf.notes@1`; history read from the hub's versions for `notes/…`.

### Phone first

The column becomes a drawer, docs fill the width, Split shows one side at a time with a Write / Preview switch, reference splits always stack, long-press opens the file menu.

## Tests

| Check | Result |
| --- | --- |
| `python3 apps/console-web/plugins/md-studio/test.py` (scopes, search, refs, chain incl. follow=import, writes, 409s, repo + hub versions, restore, notes via capability, path safety, notes off, hub not mounted) | all passed (new) |
| `npx -y tsx apps/console-web/plugins/md-studio/test.mts` (toolbar edits, find / replace, outline, ids, views, snippets, wizards) | all passed (new) |
| `npx tsc --noEmit -p apps/console-web` | no errors in md-studio |
| `check-theme.mjs`, `check-controls.mjs`, `check-plugin-pages.mjs` | clean for md-studio |
| `plugin-lifecycle.mjs check md-studio`, `uninstall.mjs --all --dry-run` | clean, nothing left behind |
| `help-coverage.mjs --check` | 100% (41 written entries) |
| `check-plugin-commands.mjs`, `plugin-commands/test.mjs`, `check-plugin-catalog.mjs` | pass |
| `plugins.mjs --check` | fails on main already (asset-designer / asset-browser pending items, molly xlayout `opens`), nothing from md-studio |

## Screenshots

`_claude/builds/reports/md-studio/shots/after/` (desktop + phone): Browse, Write (editor + live preview), IDE (outline + references docked, two panes), Context view, Wizards, Settings. Taken offline (`AXF_APPEARANCE_HUB=off`, the sandbox can't reach axHub's look). Submitted to UI Review for Brett.

## Known gaps

- **"Open context in MD Studio" on approval rows** (axHub approvals, console banner, AmberX) is not wired: those live in other apps. Ready for it: deep link `https://console.amberxai.com/?md-context=<id or path>` and the `open-context` command. The per-session `.context.md` files the handoff describes don't exist yet (separate build); once they do, the approval row links its path.
- Repo files are saved in the console container's checkout; they are not committed by MD Studio (commit from a session or Snapshots).
- Android twin: none (Android on hold; MD Studio is a console plugin, not a framework engine).
- In the headless screenshot run, fetches started later in a page sometimes waited several seconds behind the console's open live streams (HTTP/1.1 connection limit of the dev server); the API itself answers in milliseconds (`/file` 6 ms, `/files` 0.3 s, `/chain` 0.2 s on the real repo + hub).
