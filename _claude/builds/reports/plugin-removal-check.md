# Plugin removal check: can these 38 plugins go?

Build `emergency-check-can-these-plugins-`, step s11 (roll-up). **Report only: nothing was deleted or changed.**
Checked on main at `d59952c17` (Nov 27 2026).

**How this was built.** A separate repo-wide pass, independent of the group steps. For each plugin: the folder under
`apps/console-web/plugins/` was confirmed, `plugin.json` was read (provided `service:` capabilities, actions, routes,
`lifecycle.dataDir`), and the repo outside the folder was grepped for the folder name, its capabilities and its route
prefix `/api/plugins/<folder>/` across `framework/`, `apps/`, `deploy/`, `services/`, `.github/workflows/`, `CLAUDE.md`
and the rules files. Generated mirrors (`apps/*/src/axf/…`), plan data (`pending.json`, `build-queue.json`), Brett's ask log
(`build-breaker/data/asks.jsonl`) and test fixtures that only use the name as a sample string were read but are not
dependencies.

**Detail and evidence.** Each row links to its group file under [`plugin-removal-check/`](plugin-removal-check/), which lands
in the same PR and holds the file:line evidence. **Where a group file's verdict is stricter than this table, the stricter
one wins.** One place where this table is stricter than its group file: `glossary-index` is KEEP here (SAFE in 05). When
this was written, [`07-themes.md`](plugin-removal-check/07-themes.md) was still being written by step s7; the three theme
rows come from this pass only.

**Folders.** All 38 folders exist. None is already gone. One is not a plugin: `notes-tasks` has no `plugin.json` (only
`DESIGN.md`, `schema/`, `test.mjs`).

Verdicts: **SAFE** = nothing kept depends on it · **MOVE FIRST** = a kept screen or tool uses a piece of it (piece and new
home named) · **KEEP** = still needed (reason given).

## Verdicts

| Plugin | Verdict | What depends on it | What to move (and where) |
|---|---|---|---|
| [`codebase-changes`](plugin-removal-check/01-changes.md) | MOVE FIRST | Only provider of `axf.changes@1`, used by kept `systems-check` (`server/__init__.py:192`, `healthchecks.py:244,326`, `claudefix.py:25`). CI imports `changes.mjs` (`framework/spec/check-builds-store-data.mjs:257`, run at `android.yml:172`). `deploy/claude-pick.sh:111-112`, Home card `card-rules.mjs:446`, `KNOWN_BANNERS` (`lazyEngine.ts:56`). Claude Code hooks call its CLI. | `changes-core.mjs` → `framework/core/change-log.mjs`; `changes.mjs` → `framework/cli/changes.mjs`; schema → `framework/schemas/`; the `axf.changes@1` service (`server/` + `store.py`) → `apps/console-web/server/`. Then re-install hooks. Or Brett retires the change log (see 01). |
| [`changes-grid`](plugin-removal-check/01-changes.md) | SAFE | No service, route caller or data. Only a menu entry in `build-breaker/web/buildMenu.ts:25` (also being removed) and help/fixture lists. | Nothing. |
| [`activity`](plugin-removal-check/01-changes.md) | SAFE | No kept caller of `axf.activity@1` or its routes. `KNOWN_BANNERS` (`lazyEngine.ts:55`), marked lines in `deploy/claude-headless.sh:399-400`. | Nothing. Drop the `KNOWN_BANNERS` entry in the removal PR. |
| [`agent-slots`](plugin-removal-check/02-agents-sessions.md) | MOVE FIRST | Provides `axf.agent-slots@1` (optional for `build-orchestrator/server/__init__.py:123`, `claude-session/server/__init__.py:40`). Fills kept slots: `agent-swarm/web/index.tsx:13-14`, `cards.tsx:99`, `src/views/BuildManager.tsx:148,178`. `settings-sources.json:16,18,22`. The engine `framework/cli/agent-slots.mjs` is not the plugin and stays. | Queue screen (Move up / Cancel), heavy-step cap, memory guard, close-after, priority rules and the slot fills → `gate` (Builds → VPS Configuration → Build cap, `gate/web/BuildCapTab.tsx`); `gate` provides `axf.agent-slots@1`. |
| [`session-checkin`](plugin-removal-check/02-agents-sessions.md) | MOVE FIRST | VPS Claude Code SessionStart/SessionEnd hooks run its `checkin.mjs` (`/root/.claude/settings.json:50,139`). CI `android.yml:221-222`. Kept link `console-terminal/web/nav.tsx:210`. Hook check in `deploy/console-doctor.sh:66-67,102`, `systems-check/server/checks.py:431`. | Unhook first (`install.mjs --uninstall --target user` on every machine). Session browser (if wanted) → `console-terminal`. Drop CI step, nav link, doctor/systems-check item. |
| [`claude-handoff`](plugin-removal-check/02-agents-sessions.md) | SAFE | No import, route or service. CI-relevant names: `KNOWN_BANNERS` (`lazyEngine.ts:56`), Amber menu `context-menu/amber.json:95-98` + `check-design-package.mts:183`. | Nothing. Remove the menu item, its check line and the banner entry in the same PR. |
| [`axhub-handoff`](plugin-removal-check/02-agents-sessions.md) | SAFE | Only `apps/console-web/src/hubPages/test.mjs:121,229,231` (CI `android.yml:403`). | Nothing. Edit those test lines. Remove with or after `claude-handoff`. |
| [`ai-assistant`](plugin-removal-check/03-assist.md) | KEEP | Only provider of `axf.llm@1` and `axf.live-sessions@1`. Kept callers: `claude-badge`, `systems-check` (many), `maintenance`, `agent-manager/server/llm.py:30`, `wake-listener/server/__init__.py:99,202`; `agent-voice/web/index.tsx:93` opens it. | If the chat screen must go: move `LlmService` (profiles, keys, usage) into `ai-keys` first. |
| [`feature-assist`](plugin-removal-check/03-assist.md) | SAFE | Nothing. It only consumes services and fills two Plan slots that render empty without it. | Nothing. |
| [`feature-matrix`](plugin-removal-check/03-assist.md) | SAFE | Nothing kept imports the folder. The `feature-matrix@1` engine is framework (`framework/plan/feature-matrix-*.mjs`, CI `android.yml:90`) and stays. | Nothing. |
| [`build-breaker`](plugin-removal-check/03-assist.md) | SAFE | Nothing calls its routes or `build-asks@1`. Help entry only. | Nothing to move in code. Copy `data/asks.jsonl` (205 kB, Brett's ask history) out first if the history is wanted. |
| [`builds-page`](plugin-removal-check/04-builds.md) | MOVE FIRST | Home cards read its `progress` command by folder name: `framework/core/engines/card-rules.mjs:418,422`. `KNOWN_BANNERS` (`lazyEngine.ts:55`), help entries, `ref-links/refs.mjs:49`. | `progress` read → `build-orchestrator` as a `progress` command; repoint both card candidates; regenerate `framework/spec/fixtures/card.json` and mirrors. |
| [`main-build-status`](plugin-removal-check/04-builds.md) | SAFE | Only `KNOWN_BANNERS` (`lazyEngine.ts:57`) and a `buildMenu.ts` entry in build-breaker. | Nothing. Drop the banner entry. |
| [`merge-queue-view`](plugin-removal-check/04-builds.md) | MOVE FIRST | Kept `build-orchestrator` navigates to its view (`web/index.tsx:94,116`) and draws its queue slot only inside it (`:240`); `plugin.json:25` lists `axf.merge-queue@2`. Shot scripts, CI `android.yml:217-218`. | The `merge-queue` view (view + nav + menu item, ~15 lines) → `build-orchestrator`, rendering `<StatusTable mode="queue" />` directly. |
| [`fable-rebuilds`](plugin-removal-check/04-builds.md) | SAFE | Nothing kept reads it; it only adds itself to other screens. Help entry `console.json:300`. | Nothing. |
| [`shipped-features`](plugin-removal-check/05-shipped-catalog.md) | MOVE FIRST | `plan-studio-2/web/api.ts:152` opens `shipped-features.show:`. Host service runs its ledger (`deploy/host-services/bin/axf-task:20`, `services/shipped-features.json`, worker, sudoers, `framework/core/host-services.mjs:69`). Postgres `ledger_*`. `KNOWN_BANNERS`. CI `android.yml:207-208`. | Retire the `shipped-features` host service in the same build (`shipped-landed` is `framework/cli/shipped.mjs`, stays). Drop or retarget the Plan Studio `shipped` link. Brett decides on `ledger_*` tables. |
| [`whats-shipped`](plugin-removal-check/05-shipped-catalog.md) | SAFE | Only `KNOWN_BANNERS` (`lazyEngine.ts:57`) and sample ids in `lazy-loader-check.mts:37-43`. | Nothing. Drop the banner entry. |
| [`glossary-index`](plugin-removal-check/05-shipped-catalog.md) | KEEP | No code imports it, but Brett's standing rule (Nov 7 2026, `_claude/rules/RULES.md:52`, build rule `glossary-catalog`, fixer id in `framework/core/build-rules.mjs:40`) has the orchestrator rebuild the catalog through this plugin's build-hook listener on every build; CI `android.yml:233-234` runs `catalog.mjs --check`. Stricter than 05 (SAFE). | Nothing moves. It can go only after Brett retires the `glossary-catalog` rule (seed, live rules store, RULES.md line). Then drop `gate/plugin.json:48` mention and `framework/assets/book/getting-started.json:18`. |
| [`ref-links`](plugin-removal-check/05-shipped-catalog.md) | SAFE | Engine and control are framework (`framework/core/engines/refs.mjs`, `framework/react/components/RefText.tsx`). Only its own marked CI lines (`android.yml:231-232,441`). | Nothing. |
| [`notes-browser`](plugin-removal-check/06-notes.md) | MOVE FIRST | `framework/cli/project_seed_stores.py:68` loads `notes-browser/server/store.py` by path. Only provider of `axf.notes@1` (used by `md-studio/server/__init__.py:30`). Home card `card-rules.mjs:440`, `plan-studio-2/web/api.ts:151` (`nav:notes`). | `server/store.py` (`NotesStore`) → `apps/console-web/server/` next to `projects.py`; repoint `project_seed_stores.py:68`. Drop or repoint the card and the `nav:notes` link. The notes vault itself is data-store data and stays. |
| [`notes-tasks`](plugin-removal-check/06-notes.md) | KEEP | Not a plugin (no `plugin.json`). It is the `notes-tasks@1` contract: `framework/spec/PORTING.md:40`; CI runs its test by name (`android.yml:245-246`). | Nothing until Brett decides the one-store notes plan. If dropped: remove the two marked CI lines and the PORTING row with it. |
| [`todo-manager`](plugin-removal-check/06-notes.md) | MOVE FIRST | `framework/cli/project_seed_stores.py:47` loads its `server/model.py`; `project-seed.mjs:54-55`. `plan-studio-2/web/api.ts:149` (`todo-manager.open`). Live data in its `dataDir` (7 lists, 10 entries); the uninstaller deletes it. | Export the live store first. Drop or repoint `seed_todos` (`project_seed_stores.py:44-65`) and the Plan Studio to-do link to the kept to-do screen. |
| [`voice-notes`](plugin-removal-check/06-notes.md) | KEEP | Only editor of the Voice Vault setup: `apps/voicevault` reads `settings/voice-notes.json` and hub table `voice-notes/lists` (`NotesModel.kt:18-20`); README points to its settings tab; `token-control/lib/amberx-core.gen.mjs:634-650`. | Nothing while Voice Vault stays. |
| [`md-studio`](plugin-removal-check/06-notes.md) | SAFE | Nothing kept calls it. Baseline and fixture lists only. | Nothing. Remove before `notes-browser` (it is the only `axf.notes@1` consumer). |
| [`theme-manager`](plugin-removal-check/07-themes.md) | MOVE FIRST | Only provider of `axf.skin-config@1` (`web/skinConfig.ts:10`, routes `server/__init__.py:299-317`). The kept framework Settings → Appearance shows the Skin config panel only while something provides it (`framework/libs/settings/index.tsx:491,701`, `SkinConfigPanel.tsx:22`). Provides `axf.token-tree@1` (used only by `theme-editor`). Help `console.json:252`; `token-manifest-baseline.json:11`. | The skin-config REST routes (`server/__init__.py:299-317`, they shell out to `framework/cli/skins.mjs config`) and the web service `web/skinConfig.ts` → the console shell (`apps/console-web/server/` + `apps/console-web/src/`), so the Appearance panel keeps a provider. Theme asset store (`/themes`, `/presets`) needs no new home. |
| [`theme-editor`](plugin-removal-check/07-themes.md) | SAFE | Nothing. It only consumes `axf.token-tree@1`. Other mentions are sample build ids in `framework/spec/check-builds-live.mjs:201-217`. | Nothing. Remove with or before `theme-manager`. Drop it from `token-manifest-baseline.json:11`. |
| [`status-styles`](plugin-removal-check/07-themes.md) | SAFE | One feature goes with it (status animations). Display only: its stylesheet styles `data-status` marks on kept screens (`build-orchestrator/web/StatusTable.tsx`, `plan-studio-2/web/*`); they render plain without it. `KNOWN_BANNERS` (`lazyEngine.ts:60`). | Nothing. Status animations go with it. Drop the banner entry. |
| [`skin-editor`](plugin-removal-check/08-skins-designers.md) | SAFE | Nothing. The token registry is framework (`framework/core/engines/token-registry.mjs`) and stays. | Nothing. Regenerate the voice inventory fixture. |
| [`skin-gallery`](plugin-removal-check/08-skins-designers.md) | SAFE | Soft only: Settings → Appearance uses `axf.skin-switch@1` when present and falls back to the runtime (`framework/libs/settings/index.tsx:640-644`); the "Open Skins gallery" button hides. `KNOWN_BANNERS`. | Nothing. Drop the banner entry. |
| [`context-menu-designer`](plugin-removal-check/08-skins-designers.md) | SAFE | Nothing; no saved designs on the live console. | Nothing. Drop it from `token-manifest-baseline.json:8` or CI fails. |
| [`basic-filter`](plugin-removal-check/08-skins-designers.md) | SAFE | Fills two optional slots (`framework/libs/datagrid/datasets.ts:17`, `plugin-switches/web/index.tsx:28`) that render empty without it. | Nothing. |
| [`plugin-manager`](plugin-removal-check/09-plugin-tools.md) | MOVE FIRST | Console shell reads/writes the lazy loader through its routes (`src/pluginLoader.tsx:508,515`); `lazy-loader-check.mts:74` imports its `server/lazy.py`; `lazyEngine.ts:43` (`CORE_PLUGINS`); `settings-sources.json:100`; `_claude/rules/RULES.md:17`; Settings → Plugins inventory. | `server/lazy.py` + `/lazy*` routes and `server/engine.py` + `inventory.py` → console server core (`apps/console-web/server/`); `web/LazyLoader.tsx` → Settings → Plugins panel in `apps/console-web/src/`. Then drop it from `CORE_PLUGINS`. |
| [`plugin-update`](plugin-removal-check/09-plugin-tools.md) | SAFE | Nothing. The swap is console core (`server/main.py:1588`, `framework/cli/plugin-catalog.mjs:448`). | Nothing. |
| [`plugins-menu`](plugin-removal-check/09-plugin-tools.md) | SAFE | Only `KNOWN_BANNERS` (`lazyEngine.ts:56`) and data-only names in `framework/core/engines/embed.ts:181`. | Nothing. Drop the banner entry. |
| [`demonstration-designer`](plugin-removal-check/10-designers-wizards.md) | SAFE | Only reader of `service:demonstrations@1` is `glossary-index/catalog.mjs:295`, which skips a missing provider. `demo-rules.mjs` is framework. Marked CI lines `android.yml:237-238`. | Nothing. Regenerate the voice inventory fixture; drop it from `token-manifest-baseline.json`. |
| [`molly-guide`](plugin-removal-check/10-designers-wizards.md) | SAFE | One feature goes with it (Gizmo walkthroughs). No caller of its routes. It is the only renderer of the walkthrough block Gizmo writes (`agent-manager/addons/gizmo/addon.json:86`). | Nothing. Retire the `gizmo.walkthrough` / `molly.walkthrough` skills in the same build. |
| [`snapshot-manager`](plugin-removal-check/10-designers-wizards.md) | KEEP | Only provider of `axf.snapshots@1`. Container access refuses every change without it (`container-access/server/service.py:460-462,563-565`); agent manager refuses container proposals (`agent-manager/server/containers.py:121-122`). | If the tab must go: move `server/snapshots.py` and the `provide("axf.snapshots@1")` line into `container-access/server/` first. |
| [`project-wizard`](plugin-removal-check/10-designers-wizards.md) | MOVE FIRST | Voice "create a new project" runs its `/run` route (`wake-listener/catalog.mjs:68`; asserts in `wake-listener/test.mjs:108,117,119,158,172`). Help `console.json:240`. CI `android.yml:223-224`. | `wizard.mjs` → `framework/cli/` and repoint the voice entry, or drop the phrasebook entry and its asserts (voice project creation goes). |

## Counts

| Verdict | Count | Plugins |
|---|---|---|
| SAFE | 22 | changes-grid, activity, claude-handoff, axhub-handoff, feature-assist, feature-matrix, build-breaker, main-build-status, fable-rebuilds, whats-shipped, ref-links, md-studio, theme-editor, status-styles, skin-editor, skin-gallery, context-menu-designer, basic-filter, plugin-update, plugins-menu, demonstration-designer, molly-guide |
| MOVE FIRST | 11 | codebase-changes, agent-slots, session-checkin, builds-page, merge-queue-view, shipped-features, notes-browser, todo-manager, theme-manager, plugin-manager, project-wizard |
| KEEP | 5 | ai-assistant, glossary-index, notes-tasks, voice-notes, snapshot-manager |
| **Total** | **38** | |

## Edits every removal PR needs

These are not dependencies, but CI fails if a removal leaves them behind:

- `apps/console-web/src/lazyEngine.ts:55-60` `KNOWN_BANNERS`: `apps/console-web/scripts/lazy-loader-check.mts:86` fails on a name with no plugin (activity, builds-page, claude-handoff, codebase-changes, plugins-menu, skin-gallery, main-build-status, whats-shipped, shipped-features, status-styles).
- `framework/spec/token-manifest-baseline.json`: `framework/cli/token-registry.mjs` fails when an exempt folder is no longer a plugin.
- `framework/spec/fixtures/page-toolbar-voice.json`: regenerate with `npx -y tsx framework/spec/check-page-toolbar-voice.mts --write`.
- Help entries in `apps/console-web/src/assets/help/console.json` that target a removed view or action.
- `framework/spec/chrome-baseline.json` and `framework/spec/json-data-writes.baseline.json` name files in some of these folders (activity, claude-handoff, feature-matrix, md-studio, skin-editor, skin-gallery, plugins-menu, demonstration-designer, molly-guide). They are ratchets: a leftover line only warns, CI does not fail. Tidy with `--write-baseline`.
- Workflow lines marked `# axf-plugin:<folder>` go through the plugin's `uninstall.mjs`.
- Run `node apps/console-web/plugins/glossary-index/catalog.mjs --check` after each removal (glossary-index is KEEP).

## Suggested removal order

1. **SAFE, no ordering constraints:** feature-assist, feature-matrix, changes-grid, main-build-status, fable-rebuilds,
   whats-shipped, plugin-update, plugins-menu, basic-filter, context-menu-designer, skin-editor, skin-gallery,
   status-styles, demonstration-designer, molly-guide (with the Gizmo/Molly walkthrough skills), activity.
2. **SAFE, in pairs:** `ref-links` (removes the `refs.mjs` pointers at builds-page and plugin-manager);
   `build-breaker` (copy `data/asks.jsonl` out first; its Builds menu links the plugins in step 1); `claude-handoff`
   then `axhub-handoff`; `md-studio` before `notes-browser`; `theme-editor` before `theme-manager`.
3. **MOVE FIRST, one build each, piece first then folder:**
   - `merge-queue-view`: merge-queue view → `build-orchestrator`.
   - `builds-page`: `progress` command → `build-orchestrator`, repoint `card-rules.mjs:418,422`.
   - `project-wizard`: `wizard.mjs` → `framework/cli/` (or drop the voice entry).
   - `theme-manager`: skin-config routes + `web/skinConfig.ts` (`axf.skin-config@1`) → console shell.
   - `session-checkin`: uninstall the Claude Code hooks on every machine, then remove.
   - `todo-manager`: export the live store, then drop or repoint `seed_todos` and the Plan Studio link.
   - `notes-browser`: `NotesStore` → `apps/console-web/server/`, decide the `axf.notes@1` provider.
   - `shipped-features`: retire the host service, Brett decides the `ledger_*` tables.
   - `agent-slots`: queue and cap screens + `axf.agent-slots@1` → `gate`.
   - `codebase-changes`: change-log core/CLI → `framework/`, `axf.changes@1` → console server, re-install hooks.
   - `plugin-manager` last: lazy loader store + inventory → console server core, LazyLoader panel → Settings → Plugins.
4. **KEEP, do not remove:** ai-assistant, snapshot-manager, voice-notes (unless their service moves first, see rows),
   glossary-index (needs Brett to retire the `glossary-catalog` rule), notes-tasks (needs Brett's call on the notes plan).
