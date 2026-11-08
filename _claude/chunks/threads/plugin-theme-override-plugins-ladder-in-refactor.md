<!-- memory-chunk@1 source=_claude/THREADS.md lines=508-515 tokens=377 -->
### Plugin theme override + Plugins ladder — in refactor-all (was stopped by the Oct 28 STOP ORDER, since removed)

- **Asked (Brett, Oct 28 2026):** a theme override for every plugin's UI over the axHub theme (Appearance tab container with every layout, colour, style and animation token; several editing views; switch from right-click, toolbar, app menu) + application menu **Plugins ▸ All plugins ▸ <plugin> ▸ Interface · Settings · Documentation · About · Disable**. Cards: profile Refactor; every plugin UI; a setting picks the Disable look (check mark or plain toggle); submenus flip left only when there's no room.
- **Done (not merged):** s7 Plugins ladder + s8 Disable item / info dialog / framework `MenuSub` flip — branch `claude/plugin-theme-override` (WIP commit c9613386), PR #161 retitled WIP, CI green on c10129f2. Self-test `plugins-menu/test.mts` 43.
- **Left:** (#161 merged Oct 28, s71 done) Fable s1–s3 (refactor-all s68–s70: plugin-theme@1 contract, scoped engine + fixture, React layer), Opus s4–s6, s9 (refactor-all s72–s75). Matrix `refactor-all` items `plugin-theme-override:*` (keep).
- **Clash to settle in refactor-all:** held build `share-search` (grid-attach@1, toolbar + filter dialog on grids) overlaps the merged Basic filter plugin + lib-datagrid datasets (`framework/libs/datagrid/datasets.ts`); build on datasets.ts rather than a second registry.
- **Orchestrator build `plugin-theme-override`** only ever existed on the branch; on main its steps live in `refactor-all`.
