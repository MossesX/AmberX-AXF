<!-- memory-chunk@1 source=_claude/memory/handoff-2026-11-01.md tokens=428 -->
## 4. STOPPED by Brett on Nov 1 (~credits) — folders + branches intact, none landed
All were Opus. Restart = new build that continues the branch (build_start refuses an existing folder; tell it to merge claude/<old> first).
1. `builds-one-page-finish` — ONE Builds page with a view toolbar (Plan/Tracker/Queue/Pending/Orchestrator/Steps) on the one store, folds in pending-grid-view; old screens redirect. Orchestrator `builds-one-page` was archived at 4/15. **Should be Fable for the view-registry/data parts.**
2. `agent-history` — per-agent "working on now" + full history with progress meters + all-agents overview; reads existing data only; shared meter controls; plugin deps in plugin.json requirements.
3. `build-train-map` — subway-map diagram: build = line, step = stop, train = agent on its current stop, transfer stations for dependencies, live; Map view on Builds page + Breakroom + attachable widget; new map-style asset. **Fable** (new asset type).
4. `directory` — searchable Directory of every screen/view/tool, generated from registrations (shares the search-bar widget index), CI fails if a page is missing; pin to Shortcuts; add Breakroom + train map + Directory to default Shortcuts; `axf://directory`.
5. `breakroom-hooks-opus` — every way into Breakroom + Group chat (context menu Open Breakroom / Open group chat / Message in group chat, menus, shortcuts, deep links). (Old Sonnet run `breakroom-hooks` also stopped — ignore it.)
6. `build-start-fable` (axHub repo) — `vps.build_start` model enum is only opus|sonnet, so **Fable can't be launched headless**. Fix: add fable mapped to the exact CLI model name, make the model list config-driven, show model in build_list. **Do this first.**
