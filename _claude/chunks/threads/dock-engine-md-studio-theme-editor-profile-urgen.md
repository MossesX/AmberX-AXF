<!-- memory-chunk@1 source=_claude/THREADS.md tokens=362 -->
### dock-engine, md-studio, theme-editor (profile Urgent)
- Asked in full: the orchestrator builds' detail (Brett Nov 2 2026 21:30 ET). Order: dock-engine (Fable) first; md-studio after it; theme-editor any time.
- First messages: "Carry on dock-engine (Urgent) from s1 on Fable: `AXF_BUILD_PROFILE=all node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief dock-engine`." <!-- axf-plugin:build-orchestrator -->
  theme-editor: done (Nov 3 2026, PR #243, waiting in UI Review). Nothing to carry on unless Brett asks for changes there.
  "Carry on token-control (Urgent) from s1 on Fable: `AXF_BUILD_PROFILE=all node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief token-control`." <!-- axf-plugin:build-orchestrator -->
  "Carry on theme-editor (Urgent) from s1 on Opus: `AXF_BUILD_PROFILE=all node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief theme-editor`." <!-- axf-plugin:build-orchestrator -->
  token-control: see its own block below (Fable phase done Nov 3 2026).
  md-studio: built Nov 3 2026 on `claude/md-studio` (Opus, agent Reel Rhonda); s10 left = PR merge (push banner) + Brett's UI Review. Follow-ups not built: "Open context in MD Studio" on approval rows in axHub / AmberX (deep link `?md-context=<id or path>` and command `open-context` are ready; per-session context md files do not exist yet). Report `_claude/builds/reports/md-studio.md`. <!-- axf-plugin:md-studio -->
