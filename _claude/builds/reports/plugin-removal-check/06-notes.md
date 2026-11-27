# Plugin removal check 06: notes plugins

Build `emergency-check-can-these-plugins-`, step s6 (Fable, Nov 27 2026). Report only: nothing was deleted or changed.

Audited: `notes-browser`, `notes-tasks`, `todo-manager`, `voice-notes`, `md-studio` (all under
`apps/console-web/plugins/`). Each plugin's manifest was read, then the repo outside its folder was searched for the
folder name, plugin id, capabilities, action ids, route prefix, env keys, data paths and table names: `framework/`,
`apps/`, `deploy/`, `services/axf-data`, `.github/workflows`, `CLAUDE.md` and `_claude/`. Archives (`sessions/`,
`changes/`, `_claude/builds/`, `_claude/handoff/`) and the baked framework copies (`apps/*/src/axf/`) were left out of
the dependency count: they are history or generated copies.

## Verdicts

| Plugin | Verdict | What depends on it | What to move, and where |
|---|---|---|---|
| `notes-browser` | **MOVE FIRST** | `framework/cli/project_seed_stores.py:68` loads `notes-browser/server/store.py` by path (`NotesStore`) to seed project notes; called from `framework/cli/project-seed.mjs:303`. `md-studio/server/__init__.py:30` reads the Notes scope through `axf.notes@1`, which only this plugin provides (`notes-browser/server/__init__.py:122`). `framework/core/engines/card-rules.mjs:440` suggests the Home card "Recent notes" from its `notes` command. `plan-studio-2/web/api.ts:151` opens note links with `nav:notes`, and `view:notes` is provided only here (`notes-browser/plugin.json:14`). | Move `server/store.py` (`NotesStore`: the hub's memory semantics, versions, attribution, data-store@1 mirror) to `apps/console-web/server/` (next to `data_store.py` and `projects.py`, which already owns `notes_folder`), and point `project_seed_stores.py:68` at it. Decide who provides `axf.notes@1` afterwards (the kept notes plugin, or drop MD Studio's Notes scope if MD Studio goes too). Drop or re-point the card suggestion and the `nav:notes` link. The notes themselves stay (see "Data that must outlive"). |
| `notes-tasks` | **KEEP** (until the notes builds are decided) | Not a plugin: no `plugin.json`, no code, only `DESIGN.md`, `schema/notes-tasks.schema.json` and `test.mjs`. `.github/workflows/android.yml:245-246` runs `notes-tasks/test.mjs` by name (not by glob), so deleting the folder alone breaks CI. `framework/spec/PORTING.md:40` points at the design and schema as the `notes-tasks@1` contract. Builds `notes-tasks-sync` (fixing, PR #363 closed unmerged) and `blueprint-notes-tasks` (failed) build to this contract. | If Brett drops the one-store plan: remove the two workflow lines (both carry `# axf-plugin:notes-tasks`) and the PORTING row in the same change, and archive the two builds. If the plan stays, the folder is the contract and stays. Nothing at runtime loads it either way. |
| `todo-manager` | **MOVE FIRST** | `framework/cli/project_seed_stores.py:47` loads `todo-manager/server/model.py` by path (`Store`) to seed project to-dos; `framework/cli/project-seed.mjs:54-55` names its data folder (already degrades to an error message when the plugin is gone, by design). `plan-studio-2/web/api.ts:149` opens to-do links with the action `todo-manager.open` (registered at `todo-manager/web/index.tsx:27`). `apps/console-web/src/assets/help/console.json:258` has a help entry for `view:todo-manager`. `framework/spec/fixtures/page-toolbar-voice.json:1051-1096` lists its 7 toolbar buttons. Live: the plugin is **on** and holds real data (7 lists, 10 entries). | Export or migrate the live store first (see below). Then: drop the to-do half of `project_seed_stores.py` (`seed_todos`, line 44-65) or re-point it at the kept store; change the Plan Studio to-do link target (`api.ts:149`) to the kept to-do screen; remove the help entry; regenerate the voice inventory (`npx -y tsx framework/spec/check-page-toolbar-voice.mts --write`); drop it from `framework/spec/token-manifest-baseline.json:12`. |
| `voice-notes` | **KEEP** | It is the only place the Voice Vault listener is set up. Voice Vault (`apps/voicevault`, built in CI at `.github/workflows/android.yml:579-581`) only **reads** the triggers, lists and questions from `settings/voice-notes.json` and table `voice-notes/lists` on axHub (`apps/voicevault/.../notes/NotesModel.kt:18-20`), and its README sends Brett to "Settings → Plugins → Voice notes" in the console to edit them (`apps/voicevault/README.md:27`). `NotesRulesTest.kt:11` mirrors `voice-notes/core-check.mts` case for case. `token-control/lib/amberx-core.gen.mjs:634-650` projects the saved voice notes into the notes tree. `apps/console-web/src/assets/help/console.json:264` has a help entry. | Nothing to move while Voice Vault stays. If it must go anyway: first give the trigger / list / question editor a new home (the kept notes plugin's settings tab, or a Voice Vault screen that writes `settings/voice-notes.json`), keep the hub data, then remove the help entry and the baseline line (`token-manifest-baseline.json:12`). No other code imports it. |
| `md-studio` | **SAFE** | Nothing kept calls it. No import, no capability provided, no action or route used from outside. The remaining mentions are cleanup, not dependencies: `framework/spec/chrome-baseline.json:10-11`, `framework/spec/token-manifest-baseline.json:9`, `framework/spec/fixtures/page-toolbar-voice.json:582-606` (4 buttons), `_claude/memory/STATUS.md:232` and `_claude/THREADS.md` (marked `axf-plugin:md-studio`). Live: switched **off**, no data folder on the server. | Nothing. In the removal change: drop the two baseline entries and regenerate the voice inventory, or those three checks fail. `uninstall.mjs --all` strips the marked doc lines. |

## Data that must outlive the plugins

| Data | Where it lives | Owner after removal | Risk |
|---|---|---|---|
| Brett's notes vault (handoffs, session logs, plans, install notes, saved commands): 17 files today | `/projects/_shared/_claude/notes/` on the hub, mirrored in the repo at `_claude/shared/notes/`; versions and attribution in `/projects/.axhub/claude/shared/` | Not the plugin. It is the `notes` namespace of the data store (`framework/core/data-store.mjs:35`, `framework/schemas/data-store-paths.json:77-90`) and the Postgres `notes` table (`services/axf-data/tables.py:483-511`), reachable through axHub (`notes_list`, `note_read`, `note_write`: `deploy/axhub/axf-data.downstream.json:12`). | None from removing `notes-browser`: the notes are outside its `dataDir`, so its uninstaller never touches them. What is lost is the console screen to browse and edit them. `_claude/shared/notes/INDEX.md:6` tells readers to use "Plugins → Notes (notes-browser)" and needs a new pointer. |
| Per-project notes | `/projects/_shared/_claude/project-notes/<id>/` | `apps/console-web/server/projects.py:76-77` (`notes_folder`), data-store path rule `data-store-paths.json:89` | None. Same as above. |
| Console to-dos: `todo-store@1`, 7 lists and 10 entries (last written Nov 24 2026), plus `projects/test-sandbox/` | `/opt/axf/.axf-console/plugins/todo-manager/store.json`: **inside the plugin's `dataDir`** | Nobody yet | **This is the one that gets deleted.** `uninstall.mjs` removes the data folder by default. No Postgres table exists for it: `todo_items` / `todo_projects` are only planned in `framework/spec/DATA-INVENTORY.md:159`, and `services/axf-data/tables.py` has no to-do table. Copy `store.json` out (or import it into the kept store using the mapping in `notes-tasks/DESIGN.md:201-203`) before uninstalling. |
| Voice notes setup and saved notes | axHub data server, hub project `amberx-axf`: `settings/voice-notes.json`, folder `voice-notes/`, tables `lists` and `notes` | Voice Vault writes the notes; the console plugin writes the setup | None from removal: the plugin stores nothing on the console (`voice-notes/hooks.mjs:5`). No `voice-notes` folder was found under `/projects/amberx-axf/_data/` on this server, so whether any voice notes are saved today was not confirmed. |
| MD Studio version history | `.axf-console/plugins/md-studio/` (`md-studio/server/store.py:112`) | n/a | None: the folder does not exist on the live server. Files it edited are repo and hub files that stay. |

## Evidence

**Live state** (read only, `/opt/axf/.axf-console/state.json:3027-3043`, section `plugins`): `voice-notes` off,
`md-studio` off, `notes-browser` off, `todo-manager` on. Only `todo-manager` has a data folder on the server.
`notes-browser` was switched off on purpose by build `remove-console-s-own-notes-manager` ("Don't install the Notes
plugin in the console, keep its code", PR #519).

**No cross-plugin imports.** The only code outside the five folders that loads a file from one of them is
`framework/cli/project_seed_stores.py` (lines 47 and 68, both by file path). That script backs
`framework/cli/project-seed.mjs` (the Test Sandbox project seeder). No web bundle imports across these folders.

**Capabilities.** `service:axf.notes@1` is provided by `notes-browser` and consumed only by `md-studio` (declared
optional in `md-studio/plugin.json`; MD Studio shows no Notes scope without it). `view:notes`, `view:todo-manager`,
`view:voice-notes`, `view:md-studio` and the four `settings-tab:*` entries have no consumer outside their own plugin
apart from the lines in the table. `todo-manager` and `voice-notes` are `tabable`, but no host app names them.

**Routes and MCP tools.** All four real plugins use `"commands": {"auto": true}`, so their REST routes
(`/api/plugins/<folder>/…`) and generated console tools exist only while the plugin is installed. No caller of
`/api/plugins/notes-browser`, `/api/plugins/todo-manager`, `/api/plugins/voice-notes` or `/api/plugins/md-studio` was
found outside the plugin folders (the one mention, `project_seed_stores.py:16`, is a comment). The axHub tools
`notes_list` / `note_read` / `note_write` and control@1 `amberx.items` / `amberx.lists` belong to axf-data and
token-control, not to these plugins.

**Env keys.** `AXF_TODO_DIR` is read outside the plugin only by `project-seed.mjs:55`. `AXF_MD_STUDIO_DATA_DIR` has no
outside reader. `AXHUB_PROJECTS_DIR` is shared with many other plugins and stays.

**Postgres.** `services/axf-data` has one table for this area, `notes` (the vault), owned by the data service. No
table belongs to `todo-manager`, `voice-notes`, `md-studio` or `notes-tasks`. `deploy/` names none of the five plugins.

**CI.** Plugin self-tests (`test.py`, `toolbar.test.mjs`, `test.mts`) are found by glob
(`.github/workflows/android.yml:460-474`), so removing a folder does not break them. Three checks do need a matching
edit in the same change:

- `framework/spec/check-page-toolbar-voice.mts:77` compares the voice inventory with the shipped toolbar assets:
  regenerate after removing `notes-browser` (assets `notes`, `notes-note`), `todo-manager` or `md-studio`.
- `framework/cli/token-registry.mjs:260` fails when `token-manifest-baseline.json` names a folder that is not a plugin:
  all four real plugins are on that list (lines 9 and 12).
- `framework/spec/chrome-baseline.json:10-12` lists `md-studio` and `notes-browser` files; counts only go down, so
  dropping the lines is allowed.

The one by-name CI step is `notes-tasks/test.mjs` (`android.yml:245-246`).

**Test fixtures that only borrow a name** (no dependency, no change needed): `framework/spec/check-plugintheme.mts:13`
and `context-menu-designer/test.mts:89-103` use the id `ai.amberx.axf.console.todo-manager` as sample text;
`plugin-update/test.mts:12-33`, `plugin-manager/server/test_lazy.py:33-34` and `framework/spec/check-banner-hide.mts:114`
use `todo-manager` as a sample folder; `framework/spec/check-card.mjs:52` carries its own sample registry with
`notes-browser`; `framework/spec/check-builds-live.mjs:204-221`, `gen-fixtures.mts:230` and `fixtures/control.json`
use `md-studio` as a sample build id; `status-table-shots.mjs:49` and two `shots.mjs` files use `voice-notes-retry` as
a sample build id.

**Docs to clean in the removal change** (marked lines are stripped by `uninstall.mjs --all`):
`apps/console-web/plugins/README.md:50-51`, `_claude/memory/STATUS.md:139,142,227-233`, `_claude/THREADS.md:179,190,444-487`,
`framework/spec/DESIGN-LANGUAGE.md:150`, `framework/spec/DATA-INVENTORY.md:159`,
`framework/spec/fixtures/data-store-migration.json:200-201,215` (writer names only), `_claude/shared/notes/INDEX.md:6`,
`framework/catalog/status.json:2422` (a note that names `notes-browser`).

## Open decisions for Brett

1. **Which notes screen is the kept one?** `notes-browser` is already off and the `notes-tasks` plugin was never
   built (design only; its build PR #363 was closed unmerged). If both go, the console has no screen for the notes
   vault: the notes stay readable through axHub and the repo mirror only.
2. **The live to-dos** (7 lists, 10 entries) need a destination before `todo-manager` is uninstalled.
3. **Voice Vault setup**: keep `voice-notes`, or move its editor first. Removing it as it stands leaves the phone
   listener with no way to change triggers and lists.
