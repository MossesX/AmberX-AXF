<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md tokens=283 -->
## Removed
- The plugin's own copies of the contracts: `normAgent`, `normRoster`, `parseSkill`, `checkRoster`'s rules, `normAgentState`,
  `normState`, `normChat`, `normMsg`, `normChatSettings`, `normCardDesign`, `normCards`, `parseReport`, `emptyUsage`,
  `budgetTokens`, the status table, chat kinds, sliders, presets, avatar enums, `SHARED_FILES` (all in `web/swarm-core.mjs`).
- The planner's dead Haiku/Sonnet word lists (`TIER_WORDS.haiku`, `CHEAP_SKILLS`, the two-pass `requiredTier(step, skill)`).
- The avatar's hard-coded SVG paths and per-gear JSX branches in `web/cards.tsx`.
- Inline Boss strings in `applyChange`, `tick`, `recordRun`, `payCheck`, `jobs.mjs` (hire) and `swarm.mjs` (agent cap wait).
- The chat engine's own `post`, `chatOn`, line builders, banter bank, `reactors`, `banterPrompt`, `parseBanter`; the vibe
  engine's word lists and functions (both moved, see Added).
- Nothing user-visible was removed. Every tab (Crew, ID cards, Agents, Jobs, Build plan, Cost, Group chat, Chat settings),
  action, CLI command, settings key, data file and API route of the Opus build still exists with the same name.
