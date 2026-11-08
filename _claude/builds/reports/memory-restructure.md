# Memory restructure + Memory Manager plugin

Build `memory-restructure-chunked-claude-md-store-memor` (All, Opus, 9 steps), branch `claude/memory-manager-r2`,
Nov 8 2026. Brett: "Put it in a build. Send it to the org."

## What changed

1. **Chunked memory store** (`framework/cli/memory-chunks.mjs`, memory-chunks@1). CLAUDE.md and every file it
   imports, THREADS.md, STATUS.md, decisions.md, the rest of `_claude/memory/` (docs too), instructions and rules
   are split into `_claude/chunks/`: one chunk per Status entry, decision, rule, THREADS row and To carry on block,
   one per section for docs (long sections split), plus `INDEX.md` (one short line per chunk) and `index.json`.
   1185 chunks from 103 files (about 318K tokens in all). THREADS' live build log and token-pass log are left out
   (orchestrator / audit data). `build`, `check`, `list`, `show`, `find`, `sources`.
   `_claude/chunks/` sits outside claude-sync's loaded sections, so it syncs with the hub but is never printed at
   session start. The sources keep their writers; the chunks are a generated view (`build` after a change).
2. **Tiny CLAUDE.md** (22.1K → 1.9K characters). It keeps the two rules imports and the persona, and says how to
   start: `node framework/cli/memory-load.mjs` (memory-load@1, now also in the project SessionStart hook) asks the
   builds store which builds were **started in the last 24 h and stopped unfinished** (not built/complete, no store
   write for 30 min), with next step, branch, PR and the chunks that mention them, then points at the chunk index.
   The long body (stack, layout, commands, conventions, related repos, working with Brett) moved word for word to
   `_claude/memory/docs/project-guide.md` (chunked; claude-sync lists docs/ files instead of loading them).
   Headless builds load no CLAUDE.md at all (build `brief-only-headless`).
3. **Handoff deleted:** the `claude-handoff` plugin (27 files) and the `_claude/handoff/` kit (incl. the 232 KB
   `context/CLAUDE.md`). References fixed: install_instructions (§ claude.ai Project + handoff section), STATUS
   line, help source, chrome baseline, and the Amber context menu's "Account handoff" item (now "Memory Manager").
4. **Memory audit** below and in `apps/console-web/plugins/memory-manager/memory-map.json` (memory-map@1), which the
   Memory Manager reads.
5. **Memory Manager plugin** (`apps/console-web/plugins/memory-manager`, own nav entry under Plugins and Builds,
   Amber menu item). MD Studio's code is **duplicated, not shared** (renamed ids, its own `mm-*` dock tab kinds so the
   two can run side by side), so MD Studio can be deleted later. Column panels (TabGroup): **Memory**, Files,
   **Chunks**, **Session start**, Snippets, Wizards.
   - Memory: every memory file (293 on this checkout; chunks, change log and session archive fold into one row each
     unless a setting lists them) grouped by category / location / root / kind, with what writes and reads each one
     (audit map + a code scan you refresh with *Scan again*); filters for category, kind, where, writer and loaded at
     start; search inside every file; per file: view, edit, versions, move/rename, delete (text kept as a version,
     restore brings it back; hub files keep axHub's history).
   - Chunks: the index with a filter, open any chunk, *Rebuild chunks*.
   - Session start: what a session loads (24 h / 48 h / 3 d / 7 d window).
   - Settings (Settings → Plugins → Memory Manager): categorized collapsible sections Scan, List, Safety, Chunks
     (server-side, so REST/MCP/CLI/voice change the same values), plus the editor's own settings.
   - API: every route is a plugin command (REST, MCP, `axf memory-manager …`): `memory`, `scan`, `memory/file`,
     `search`, `move`, `delete`, `chunks`, `chunks/build`, `load`, `audit`, `settings` (GET/PUT) plus MD Studio's
     `files`, `file`, `history`, `version`, `restore`, `chain`, `refs`. Voice/console actions: `memory-manager.show |
     memory | files | rescan | search | filter | details | move | delete | history | chunks | build-chunks | load |
     setting | settings` and the editor's `open | edit | context | toggle-edit | save | view`.
   - Deep link: `#/memory-manager?memory-panel=memory|files|chunks|start&memory-file=<path>&memory=<file>`.

## Memory audit: every part of the app that writes (or reads) memory

| Location | Kind | Loaded at start | Writers | Readers |
|---|---|---|---|---|
| CLAUDE.md (root) (`CLAUDE.md`) | memory | yes | Claude sessions: edited by hand when a rule or convention changes<br>plugin lifecycle (`framework/cli/plugin-lifecycle.mjs`): uninstall strips lines marked <!-- axf-plugin:<folder> --><br>claude-project (`framework/cli/claude-project.mjs`): writes a new project's CLAUDE.md or adds the rules import | Claude Code: loaded at every session start with its @imports<br>agent swarm (`apps/console-web/plugins/agent-swarm/swarm.mjs`): counts the tokens a plain session loads<br>memory chunks (`framework/cli/memory-chunks.mjs`): chunked into _claude/chunks/<br>MD Studio (`apps/console-web/plugins/md-studio/server/store.py`): lists and edits it, follows its @imports |
| Rules (project + shared) (`_claude/rules/**`, `_claude/shared/rules/**`) | memory | yes | Claude sessions: a rule Brett states is saved here<br>claude-sync (`~/.local/bin/claude-sync`): three-way sync with /projects/<name>/_claude and /projects/_shared/_claude<br>plugin lifecycle (`framework/cli/plugin-lifecycle.mjs`): strips a plugin's marked lines on uninstall | Claude Code: @imported by CLAUDE.md<br>claude-sync start: printed at session start when not imported<br>agent swarm (`apps/console-web/plugins/agent-swarm/swarm.mjs`): token count of a plain session |
| Persona (`_claude/persona.md`) | memory | yes | Claude sessions: by hand | Claude Code: @imported by CLAUDE.md |
| THREADS.md (threads and builds log) (`_claude/THREADS.md`) | memory | no | Claude sessions: a row per thread and a To carry on block, by hand<br>builds live (`framework/cli/builds-live.mjs`): appends one Live build log line per store write and commits it to main<br>token passes (`apps/console-web/plugins/token-control/lib/pass.mjs`): appends Token passes (log) lines<br>claude-sync: syncs it with the hub | Claude sessions: read on load (project rule)<br>agent swarm (`apps/console-web/plugins/agent-swarm/swarm.mjs`): token count<br>memory chunks (`framework/cli/memory-chunks.mjs`): one chunk per thread row and To carry on block; the live log and token passes are left out (builds data / audit log) |
| STATUS.md (`_claude/memory/STATUS.md`) | memory | no | Claude sessions: a status entry per landed feature<br>plugin lifecycle (`framework/cli/plugin-lifecycle.mjs`): strips marked lines on uninstall | systems check (`apps/console-web/plugins/systems-check/server/routine.py`): reads the status for the routine check<br>claude-sync start: printed at session start (memory/ section, within its load budget)<br>memory chunks (`framework/cli/memory-chunks.mjs`): one chunk per status entry |
| decisions.md (`_claude/memory/decisions.md`) | memory | no | Claude sessions: a decision Brett makes | build breaker (`apps/console-web/plugins/build-breaker/web/bb-core.mjs`): links decisions.md references<br>memory chunks (`framework/cli/memory-chunks.mjs`): one chunk per decision |
| Other memory files (`_claude/memory/*.md`, `_claude/memory/todo/**`, `_claude/README.md`, `_claude/fuck-you.md`) | memory | no | Claude sessions: handoff notes (memory/handoff-<date>.md, Claude setting memory.handoffNote), follow-ups, registry notes | claude-sync start: printed at session start within its budget<br>memory chunks (`framework/cli/memory-chunks.mjs`): chunked per section |
| Specs and docs (memory/docs) (`_claude/memory/docs/**`) | memory | no | Claude sessions: a doc per feature; rebuild differences reports in docs/rebuilds/ (project rule)<br>rebuild shots (`framework/cli/rebuild-shots.mjs`): before/after screenshots under docs/rebuilds/<id>/shots<br>android rebuild shots (`.github/workflows/rebuild-shots.yml`): commits docs/rebuilds/<id>/android.md | fable rebuilds (`apps/console-web/plugins/fable-rebuilds/server/__init__.py`): lists rebuild reports<br>claude-sync start: listed (path and size), read on demand<br>memory chunks (`framework/cli/memory-chunks.mjs`): chunked per section |
| Instructions (`_claude/instructions/**`, `_claude/shared/instructions/**`) | memory | yes | Claude sessions: by hand<br>claude-sync: hub sync | claude-sync start: printed at session start |
| Shared memory (every project) (`_claude/shared/memory/**`, `_claude/shared/notes/**`, `_claude/shared/*.md`) | memory | yes | claude-sync: synced with /projects/_shared/_claude<br>Notes Vault (`apps/console-web/plugins/notes-browser/server/store.py`): writes notes on the hub (/projects/_shared/_claude/notes) | claude-sync start: printed at session start |
| Memory chunks (generated) (`_claude/chunks/**`) | generated | no | memory chunks (`framework/cli/memory-chunks.mjs`): build: one chunk per entry or section + INDEX.md + index.json<br>Memory Manager (`apps/console-web/plugins/memory-manager/server/store.py`): Rebuild chunks button / POST /chunks/build | memory load (`framework/cli/memory-load.mjs`): session start: index summary and the chunks of stopped builds<br>Claude sessions: grep INDEX.md, read single chunks |
| Session notes (_claude/sessions) (`_claude/sessions/**`) | log | no | Claude sessions: a day's session notes (Claude setting memory.sessionNotes) | MD Studio / Memory Manager: browse |
| Session check-in archive (sessions/) (`sessions/**`) | log | no | session check-in (`apps/console-web/plugins/session-checkin/lib.mjs`): one session-log@1 record per session (hub copy first, repo copy as fallback) | plugin lifecycle (`framework/cli/plugin-lifecycle.mjs`): treated as history<br>session check-in (`apps/console-web/plugins/session-checkin/lib.mjs`): lists past sessions |
| Codebase changes log (changes/) (`changes/**`) | log | no | codebase changes (`apps/console-web/plugins/codebase-changes/changes.mjs`): change-log@1 entry per request (hooks + CLI); hub copy in /projects/amberx-axf/_data/changes | Build manager: Live list and history |
| Build reports (`_claude/builds/reports/**`, `_claude/builds/README.md`, `_claude/builds/BRIEF-TEMPLATE.md`) | builds | no | build sessions: a report per build (project rule) | maintenance (`apps/console-web/plugins/maintenance/engine/profiles.mjs`): links a build's report<br>what's shipped (`apps/console-web/plugins/whats-shipped/server/__init__.py`): wording from the report |
| Builds store (orchestrator) (`_claude/builds/store.json`, `_claude/builds/origins.json`, `_claude/builds/orchestrator.json`, `_claude/builds/profiles/**`) | builds | no | orchestrator (`apps/console-web/plugins/build-orchestrator/orchestrator.mjs`): every build write, versioned in the journal<br>builds live (`framework/cli/builds-live.mjs`): status-only commits to main | memory load (`framework/cli/memory-load.mjs`): builds started in the last 24 h that stopped unfinished |
| Plans (`_claude/plans/**`) | memory | no | Claude sessions: plan write-ups | Claude sessions: on demand |
| Handoff kit (deleted) (`_claude/handoff/**`) | memory | no | claude-handoff plugin (deleted Nov 8 2026): handoff.mjs build/publish wrote the kit; removed with this build | — |
| User CLAUDE.md (~/.claude) (`~/.claude/CLAUDE.md`) | memory | yes | claude-sync install: adds its block<br>claude-pick (`deploy/claude-pick.sh`): adds / removes the rules import | Claude Code: every session on this machine<br>session check-in (`apps/console-web/plugins/session-checkin/lib.mjs`): lists it |
| Hub copy (/projects/amberx-axf/_claude) (`amberx-axf/**`, `_shared/**`) | memory | no | claude-sync: three-way sync<br>axhub.memory_write: claude.ai sessions<br>Notes Vault (`apps/console-web/plugins/notes-browser/server/store.py`): notes | axhub.memory_read: claude.ai sessions<br>claude-sync: pull |

The code scan adds every other file that names a memory path (shown per file in the Memory Manager, marked
"code scan"); tests, fixtures and `framework/spec/check-*` are left out.

## Overlap

`handoff-2` (PR #338, built, 881 commits behind main) also deletes `claude-handoff` + `_claude/handoff` + THREADS.md
and edits CLAUDE.md. The deletions are identical (git merges them), the CLAUDE.md edit will conflict: on its
rebase keep this CLAUDE.md and add its session-sync line. Notes left on both builds.

## Gaps

- `claude-sync start` (lives in the axHub repo, not here) still prints `_claude/memory/*.md` (STATUS.md, decisions)
  within its 300 KB budget at session start. Real savings at start need it to print only the chunk index when
  `_claude/chunks/INDEX.md` exists: follow-up in axHub.
- The chunks are regenerated by hand (`memory-chunks.mjs build`, the Memory Manager button, or the
  `chunks.rebuildOnSave` setting is stored but not yet acted on by the editor); `check` is not in CI so other
  sessions' STATUS edits don't turn CI red. The loader and `find` read the live sources, so they are never stale.
- The rules imports stay in CLAUDE.md (36 KB): they are hard constraints. Dropping them is a one-line change.
- UI Review options are three `layout` assets mapped to the page's existing views (Browse, Read, IDE).
- Android: none (on hold).

## Tests

| Check | Before | After |
|---|---|---|
| `node framework/spec/check-memory-chunks.mjs` (new, in CI) | — | 32 ✓ |
| `python3 apps/console-web/plugins/memory-manager/test.py` | — | 97 ✓ (59 copied from MD Studio + 38 memory checks) |
| `npx -y tsx apps/console-web/plugins/memory-manager/test.mts` | — | all passed |
| console `tsc --noEmit` | ✓ | ✓ |
| check-theme / check-controls / check-toolbars / check-chrome-assets | ✓ | ✓ |
| plugin-lifecycle check memory-manager, claude-settings, agent-swarm | ✓ | ✓ |
| help-coverage --check | — | ✓ (drafts for the new controls; 3 older gaps in feature-matrix, glossary-index, notes-browser filled) |
| glossary catalog --check | 388 | 388 |
| check-design-package.mts | 1158 ✓ | 1158 ✓ |
