# Plan Studio 2.0 (fable-rebuild-plan-studio-cleared-out)

Built Nov 16 2026, branch `claude/fable-rebuild-plan-studio-cleared-out`. Phase 1 (s1) on Fable, phase 2 (s2, s3) on
Opus. Differences report: `_claude/memory/docs/rebuilds/fable-rebuild-plan-studio-cleared-out.md`.

Brett (Nov 16 2026, 20:25): "Same thing for Plan Studio. I don't want anything synced with Plan Studio, I want it all
cleared out, nothing in it, and rebuild the whole thing. Professional, powerful, full context menu, voice controlled,
integrated with everything else."

## What landed
- **s1 (Fable):** a new plugin `apps/console-web/plugins/plan-studio-2/` beside the original Plan Studio, which is
  byte-for-byte unchanged. Starts empty, nothing synced in. One tree (`plan-tree@1`): plans, sections, steps, notes, lists
  nested to any depth, drag to move at any level, a 15-entry context menu on every row, an editor, a Trash with undo, a
  command box and a mic (deterministic voice parser, wake listener phrasebook "plan studio …"). 24 server routes, each an
  MCP tool, REST command and CLI call.
- **s2 (Opus):** a layout switcher on the page toolbar. The page is four sections (Tree, Editor, Say, Trash) shown as:
  1. **Nav menu** (default): every section on one page with a section nav; tree and editor side by side on a wide screen.
  2. **Tabs:** a framework TabGroup across the top (`plan-studio-2.sections`), one section at a time.
  3. **IDE:** dockable panes, a TabGroup in each pane (`plan-studio-2.pane`). Drag a tab to another pane's tab row or
     centre to join its group, onto a pane edge to split it, along its own row to reorder; resize with the splitters
     (mouse, touch, arrow keys); close tabs or panes and reopen them from the toolbar; reset.
  IDE arrangements come from the same `dock-layout@1` assets as the original Plan Studio's layouts build (the
  framework's ten in `framework/assets/dock-layout/`, plus any registered later) through "Arrange panes…". The layout
  registry in `web/layout-core.mjs` is open (`registerLayout`), and so is the section list. Collapse all / Expand all stay
  on the toolbar and are now actions too.
- **s3:** tests, this report, THREADS row. Also fixed the one red check on main: `check-console-control` flagged the
  Claude settings tab row because its id came from a constant; it now uses the same id as a literal.

## How each layout feature is reached
| Feature | UI | REST / MCP / CLI / voice (console-control) |
|---|---|---|
| Pick a layout | toolbar Segmented "Page layout"; Settings → Plugins → Plan Studio 2.0 | action `plan-studio-2.layout:<nav\|tabs\|ide or words>[:<dock-layout id>]`; setting `plan-studio-2.pageLayout` |
| Arrange IDE panes from an asset | "Arrange panes…" | `plan-studio-2.layout:ide:<dock-layout id>` |
| Move / split / close / reopen / show / reorder / reset | drag tabs, pane ✕, tab ✕, Reopen…, Reset | `plan-studio-2.dock:move:<section>:<pane>[:<i>]`, `split:<section>:<pane>:<side>`, `close-pane:<pane>`, `close:<section>`, `reopen:<section>`, `show:<section>`, `reorder:<pane>:<a,b,c>`, `reset` |
| Show one section | nav links, tabs | `plan-studio-2.section:<tree\|editor\|say\|trash>` |
| Collapse all / Expand all | toolbar | `plan-studio-2.collapse-all`, `plan-studio-2.expand-all`; server `POST /collapse`; voice "collapse all" |
| Read the state | — | settings `plan-studio-2.pageLayout`, `plan-studio-2.dock`, `plan-studio-2.tab` |

All of these go through REST `/api/console-control`, the `console_control_*` MCP tools, `axf console …` and AmberX voice
(the inventory in `apps/console-web/src/control/inventory.json` was regenerated).

## Tests
- `node apps/console-web/plugins/plan-studio-2/test.mjs`: 17 checks (14 → 17: layout registry, every framework
  dock-layout asset, dock moves / splits / close / reopen / resize / ops).
- Console `tsc --noEmit` and `vite build` clean. check-theme, check-controls, check-toolbars, check-chrome-assets,
  check-plugin-pages, check-console-control (now green), help-coverage `--check`, plugin-lifecycle, plugin-commands,
  menu-reach all pass. wake-listener 109/109, claude-settings 93/93. The original `plan-studio` folder has no diff vs main.

## Known gaps
- `theme-swap.mjs` was not run here: this worktree has no Playwright. CI runs it; the new CSS only uses tokens and
  `color-mix` with `--fx-opacity-tint`, the same pattern as the original Plan Studio's dock.
- No screenshots: no running console in this worktree. First live run: `axf shot … --group "fable-rebuild-plan-studio-cleared-out"`
  of each layout.
- Layout and dock are per-user console settings (like the original), not stored in the tree, so the plugin's own
  `say` route doesn't switch layouts; voice reaches them through console-control instead.
