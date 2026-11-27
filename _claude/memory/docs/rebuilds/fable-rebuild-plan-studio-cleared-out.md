# Rebuild report — `fable-rebuild-plan-studio-cleared-out` (Plan Studio 2.0, Fable, Nov 16 2026)

Branch `claude/fable-rebuild-plan-studio-cleared-out`, step s1 on Fable. Brett (Nov 16 2026, 20:25): "Same thing for Plan
Studio. I don't want anything synced with Plan Studio, I want it all cleared out, nothing in it, and rebuild the whole
thing. Professional, powerful, full context menu, voice controlled, integrated with everything else."

The step as filed says: do not touch, clear or delete the existing Plan Studio or any of its plans; build a brand-new
separate plugin **Plan Studio 2.0** (`plan-studio-2`) that starts empty. That is what landed. The original
`plan-studio` plugin, its plans, store, CLI, schema, fixtures and tests are byte-for-byte unchanged on this branch.

## Summary

Plan Studio 2.0 is one tree (`plan-tree@1`): plans, sections, steps, notes, lists and list items nested inside each other
to any depth, with no fixed shape (a note can hold a plan, a list item can hold a section). Every row is dragged (lib-dnd,
mouse and touch grip) to any level, and every row has the full context menu: new inside, rename / edit, done, duplicate,
move up / down / indent / outdent / move to…, link to…, export, send to the build orchestrator, delete (to the trash,
undo brings it back where it was). The page has an editor for the selected row, a Trash tab, a command box and a mic.
Nothing is synced into it: the to-do manager, the orchestrator, Notes and Shipped features are reached only through
explicit links (`todo | build | note | shipped | plan | url`). Every action is the same through the console API, MCP,
the CLI and voice, because all of them call one pure core (`web/tree-core.mjs`) through `tree.mjs api`.

## Removed (nothing)
- Nothing was removed. The old Plan Studio stays installed and enabled beside the new one (Builds → Plan Studio and
  Builds → Plan Studio 2.0). Clearing or retiring it is Brett's call once 2.0 has what he needs; `plan-studio-2` has no
  import, read or migration from `plan-studio` (the self-test fails if any file names its folder or its plan@1 files).

## Kept (from the old plugin's shape, re-done)
- A page under Builds, a `builds.toolbar` button, a right-click entry, a Settings → Plugins sub-tab with the lifecycle
  panel, `install.mjs` / `uninstall.mjs` / `hooks.mjs`, a Node CLI the Python server shells out to, a self-test, a help
  pack, AmberX as a target (`amberx-droid`), voice through mic-lease@1 and agent-voice@1.
- Send to the build orchestrator writes the same orchestrator@1 record the old plugin wrote (pending build, steps with
  model and estimate, `source`, a note naming the item, build-origin@1 `said` when a sentence was spoken).

## Changed
- **Data model.** plan@1 (one JSON + Markdown body per plan, categories, templates, saved views, history, catalog) →
  plan-tree@1 (one file `tree.json`: `items[]` with `parent` + `order`, plus `trash[]`). Any kind inside any kind.
  Normalize breaks cycles, re-roots orphans, renumbers orders. Ids are `<slug>-<4 chars>`.
- **Store.** `_data/plan-studio/plans/<id>.json` → `_data/plan-studio-2/tree.json` on the hub (per project, projects@1),
  else `.axf-console/plugins/plan-studio-2/`; `AXF_PLAN_TREE_DIR` for tests. Starts empty; no seeds.
- **Surfaces.** The old plugin had one `POST api {op}` route; 2.0 has one route per command (22 commands + 7 reads), so
  plugin-commands@1 gives each its own MCP tool (`plan-studio-2_add`, `plan-studio-2_say`, …), REST command
  (`/api/control/plan-studio-2/<command>`) and CLI call (`axf plan-studio-2 <command>`). Deletes carry the confirm flag.
- **Voice.** The old plugin's AI conversation (axf.llm@1 prompt → diff → apply) is replaced by a deterministic parser
  (`parseVoice`): new plan X · add a step X to Y · rename · delete · undo · duplicate · mark done · move into / up /
  down / to the top · collapse / expand · open · find · export · send X to the build orchestrator. One route `say`
  runs it; the wake listener's phrasebook sends "plan studio …", "tell plan studio …", "plan tree …" there and speaks
  the reply (`speak: 'say'`).
- **Context menu.** Was the console's default menu only; now a per-row target (`axp-plan-studio-2-item`, payload = id)
  with 15 entries, each an action that also runs from the API with an argument (id or words).

## Added
- Plugin `apps/console-web/plugins/plan-studio-2/`: `plugin.json` (commands declared with titles, descriptions,
  read-only / destructive flags), `tree.mjs` (store + CLI + `api` dispatcher + orchestrator hand-off), `hooks.mjs`,
  `install.mjs`, `uninstall.mjs`, `help.json` (60 entries + an intro), `server/__init__.py` (24 routes + capability
  `plan-tree@1`), `web/tree-core.mjs` (+ `.d.mts`), `web/api.ts`, `web/ui.tsx`, `web/index.tsx`, `web/menu.ts`,
  `web/voice.ts`, `web/plan-studio-2.css`, `test.mjs`.
- Console-control: view `view:plan-studio-2`, tab row `plan-studio-2.tabs` (Tree · Trash), every row's title
  `button:item.<id>`, toolbars "Plan Studio 2.0 actions", "Tree tools", "Say a command", "Item actions", settings
  `plan-studio-2.*`. Inventory regenerated.
- Deep link `plan-studio-2.focus:<id or words>` (console_show / console_open `plan-studio-2`, `find` hits carry it).
- Voice phrasebook entries `plan-studio-2/say`, `plan-studio-2/find`, `plan-studio-2/undo` in the wake listener's catalog.
- CI: `node apps/console-web/plugins/plan-studio-2/test.mjs` (android.yml) and the plugin's README line.

## How each feature is reached (Brett, Nov 8 2026: everything comes with an API)
| Feature | UI | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| Open the page / one item | Builds → Plan Studio 2.0; row click | `console_show plan-studio-2` with `input.focus` | `console_open` / action `plan-studio-2.focus` | `axf console open plan-studio-2` | "open <item>" (say) |
| Read the tree | the page | `GET /api/plugins/plan-studio-2/state` · `/tree` · `/item/{id}` · `/find` · `/export` | `plan-studio-2_state` · `_tree` · `_item` · `_find` · `_export` | `tree.mjs tree|list|show|find|export` | "find <words>" |
| Add / rename / edit / done | dialogs, editor, checkbox | `POST /add` · `/rename` · `/edit` | `plan-studio-2_add` · `_rename` · `_edit` | `add` · `rename` · `edit` | "new plan X", "add a step X to Y", "rename X to Y", "mark X done" |
| Move (drag, up/down, indent/outdent, move to) | drag grip, menu | `POST /move` · `/nudge` · `/indent` · `/outdent` | the same names | `move` · `up` · `down` · `indent` · `outdent` | "move X into Y", "move X up", "move X to the top" |
| Duplicate | menu | `POST /duplicate` | `plan-studio-2_duplicate` | `duplicate` | "duplicate X" |
| Delete + undo | menu, drag to the trash can, Undo button, Trash tab | `DELETE /item/{id}` (confirm) · `POST /undo` | `plan-studio-2_delete` · `_undo` | `delete` · `undo` · `trash` | "delete X", "undo" |
| Links (todo, build, note, shipped, plan, url) | Link… dialog, editor list | `POST /link` · `/unlink` | `plan-studio-2_link` · `_unlink` | `link` · `unlink` | — |
| Collapse / expand | fold buttons, toolbar | `POST /collapse` | `plan-studio-2_collapse` | `collapse` · `expand` | "collapse all", "expand X" |
| Export / import | toolbar, menu | `GET /export` · `POST /import` | `plan-studio-2_export` · `_import` | `export` · `import` | "export X" |
| Send to the build orchestrator | Send to build… (preview, build id) | `POST /build` (`preview: true` = dry run) | `plan-studio-2_build` | `build [--preview]` | "send X to the build orchestrator" |
| Say a command | command box, Talk | `POST /say` | `plan-studio-2_say` | `say "…"` | wake listener: "plan studio …" |
| Clear everything | — (on purpose) | `DELETE /all` (confirm) | `plan-studio-2_clear` | `clear --yes` | — |
| Settings (show done, model for new steps, spoken replies, voice language) | Settings → Plugins → Plan Studio 2.0 | console-control `setting:plan-studio-2.*` | `console_control_*` | `axf console set …` | "set … to …" |

## Contracts, assets, fixtures
- New data contract `plan-tree@1` and export `plan-tree-export@1` (in the plugin, not yet a framework engine: the
  tree has one consumer). Capability `plan-tree@1` (Python `plugin_services`). No asset types, tokens or fixtures changed.
- No Android / Kotlin work (frozen); nothing to record in PORTING.md beyond the plugin's AmberX target loading unchanged.

## Migration / compatibility
- None needed: nothing reads the old store, nothing writes it. Anyone wanting old plans in 2.0 can export a plan@1 as
  JSON from the old plugin and `tree.mjs import` a hand-made plan-tree-export@1, or re-enter them (Brett asked for a
  clean start).
- Other plugins that used `plans@1` keep working against the old plugin. `plan-tree@1` is the new capability.

## Tests before vs after
- Before: no plugin. After: `test.mjs` 14 checks (core nesting, moves, cycles, duplicate, delete + undo in place, links,
  collapse, export / import, normalize, build hand-off, 20 voice forms, CLI + store on a scratch folder, old-plugin
  separation). tsc clean; check-theme, check-controls, check-toolbars, check-plugin-pages, check-chrome-assets,
  plugin-commands check + spec, plugin-lifecycle check, help-coverage, menu-reach, control-inventory all pass. wake-listener
  test 109/109 with the new phrasebook.

## Known gaps
- `check-console-control.mjs` was red on main (a Claude settings tab row whose id came from a constant); fixed in s3.
- No screenshots or ui-choices options: this worktree has no built console to capture from; the page follows the
  framework controls and tokens and the plugin-pages design check. First live run should capture one shot of the tree
  and the context menu (`axf shot … --group "fable-rebuild-plan-studio-cleared-out"`).
- The Python server is not exercised by a pytest here (the CLI it shells to is); the routes are declared in
  `plugin.json` and verified by `plugin-commands.mjs check`.
- `plan-tree@1` lives in the plugin; if a second consumer appears (AmberX offline, axHub), promote it to
  `framework/core/engines/` with a fixture.

## Phase 2 (s2, Opus): page layouts
- **Added:** `web/layout-core.mjs` (+ `.d.mts`) and `web/layout.tsx`. The page is four sections (Tree, Editor, Say,
  Trash) shown as a nav menu (default), a TabGroup across the top, or IDE dockable panes with a TabGroup in each pane
  (drag between panes, drop into another tab group, split on edges, resize, close, reopen). IDE arrangements come from
  the framework's `dock-layout@1` assets, the same ones the original Plan Studio's layouts build uses.
- **Changed:** the Tree · Trash tab row (`plan-studio-2.tabs`) is gone; its place is the layout. Tab rows are now
  `plan-studio-2.sections` (tabs layout) and `plan-studio-2.pane` (IDE). The command box is its own section (Say).
- **API:** actions `plan-studio-2.layout`, `.dock`, `.section`, `.collapse-all`, `.expand-all`; settings
  `plan-studio-2.pageLayout`, `.dock`, `.tab`. No server routes or contracts changed.
- **Tests:** 14 → 17 checks. Build report: `_claude/builds/reports/fable-rebuild-plan-studio-cleared-out.md`.
