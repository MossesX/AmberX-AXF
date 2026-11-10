# Orchestrator and Build Manager: search bar + Collapse all / Expand all

Build `orchestrator-and-build-manager-search-bar-collap` · Phase 1 · Opus · branch `claude/orchestrator-and-build-manager-search-bar-collap`

Brett said (2026-11-09 18:51): "Is there no search bar in the orchestrator? I can't find this. I need to collapse all."

## What changed

### Build orchestrator (`apps/console-web/plugins/build-orchestrator`)
- **Search bar** above the tab group on the Pipeline and Builds tabs. It finds a build by every word, in any order, across the title, id, branch, PR, account, category, status, detail, Brett's words, step texts and notes. Case and accents are ignored. On the Pipeline tab each section's count reads `hits/total`. On the Builds tab a search also finds hidden and archived builds.
- **Collapse all / Expand all** next to the search box. Each one acts on rows and on section headers.
- **Collapsible section headers**: Claude accounts, Pending, Queue and Building on the Pipeline tab, plus the category groups of the Builds grid. Which sections are open, which tab is shown and the row mode are kept in local storage, so they survive a reload. The search words are not kept.
- **Pipeline cards** can now fold down to their title.
- The Builds grid's old per-grid "Collapse all" button is replaced by the page-level pair.
- Pure helpers in `orchestrator-core.mjs`: `searchText`, `matchBuild`, `collapseAll`. Each has a test in `test.mjs`.
- `web/view-state.ts` is the one store that the page, the actions and the read-back all share. `web/sections.tsx` holds the section header and the search bar.

### Build manager (`apps/console-web/plugins/build-manager`)
- It already had a search bar. Its search now also covers account, addedBy and PR.
- **Collapse all / Expand all** added to the Remaining list.
- `web/view-state.ts` holds the search words and runs collapse commands. Each command is applied only once.

## API (every way in is the same)
| What | Console action (REST `POST /api/control` / MCP `console_action` / CLI `axf control act console.actions …` / voice) | Other |
|---|---|---|
| Open (deep link) | `build-orchestrator.open:<pipeline\|builds\|approvals\|rules>`, `nav:build-orchestrator`, `build-manager.open` | `console_open build-orchestrator` |
| Search | `build-orchestrator.search:<words>`, `build-manager.search:<words>` | REST `GET /api/plugins/build-orchestrator/search?q=…&all=` · plugin command `search` (MCP / voice) · CLI `orchestrator.mjs search <words> [--all] [--json]` |
| Clear search | `build-orchestrator.clear-search`, `build-manager.clear-search` | |
| Collapse / expand all | `build-orchestrator.collapse-all[:rows\|sections]`, `build-orchestrator.expand-all[:rows\|sections]`, `build-manager.collapse-all`, `build-manager.expand-all` | |
| One section | `build-orchestrator.section:<id> [collapse\|expand\|toggle]`. Ids: `pl:accounts`, `pl:pending`, `pl:queued`, `pl:building`, `cat:<category>` | |
| Read the state | `build-orchestrator.view-state`, `build-manager.view-state` (one line: tab, search, collapsed sections and rows) | |

## Checks
- `node apps/console-web/plugins/build-orchestrator/test.mjs`: 35 passed.
- `pipeline.test.mjs`: 35 passed.
- `test.py`: 31 passed.
- `node apps/console-web/plugins/build-manager/test.mjs`: 127 passed.
- `tsc --noEmit` for console-web: clean.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass.
- `plugin-lifecycle check`:
  - build-orchestrator fails on stale references in `framework/cli/dispatch-gate.mjs`. That file is the same on `main`, so the failure was already there.
  - build-manager fails only because the live-preview `.axf-focus.json` names it. That file is not part of this change.

## Skipped
- Screenshots and the UI Review submission were skipped. The brief marks them non-essential, so the step is kept and recorded here.

## Not covered
- The "split-builds-pages" table work has not started on any branch, so there was no shared build-table asset to fold this into. Each plugin keeps its own search and collapse store, because plugins can't import from each other's folders.
- The Build manager's Sessions tab keeps its existing Collapse all. The page-level buttons appear only on the Remaining tab.
