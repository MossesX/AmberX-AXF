<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md lines=72-87 tokens=381 -->
## Added
- `framework/core/engines/swarm-rules.mjs` (+ `.d.mts`): `SWARM` registry, `TAGS`, normalizers and validators for the
  seven records, `swarmErrors` / `normSwarm` front doors, `parseReport`, `budgetTokens`, `jsonSchemas()`; swarm-roster@1
  `fallback`; swarm-run@1 is one record for the swarm runner (kind `build`) and agent jobs (kind `job`).
- `framework/core/engines/swarm-chat.mjs` (+ `.d.mts`) and `framework/core/engines/swarm-vibe.mjs` (+ `.d.mts`).
- `framework/core/engines/agent-card-rules.mjs`: `AVATAR_BOX`, `AVATAR_HAIR`, `AVATAR_FACE_SHAPES`, `AVATAR_GEAR_PARTS`,
  `AVATAR_PAINTS`, `avatarColors`, `avatarModel`.
- `framework/schemas/swarm.json` (registry snapshot) and seven JSON Schemas in `framework/schemas/json/` (`agent`,
  `agent-skill`, `swarm-roster`, `swarm-state`, `swarm-job`, `swarm-report`, `swarm-run`), written by `axf schemas`.
- Fixtures `framework/spec/fixtures/swarm.json`, `swarm-chat.json`, `swarm-vibe.json`, and `avatar` in `agent-card.json`.
- `framework/spec/check-swarm.mts` (CI, `android.yml`): fixture replay for every normalizer, validator, builder and vibe
  rule; the snapshot and schemas current; the shipped roster and skills valid and on allowed models; the plugin's core
  re-exports the framework's functions.
- Plugin core: `folderIndex`, `indexBlocks`, `FOLDER_INDEX_MAX`; `swarm.mjs listFolder`. Planner tests for the policy, the
  fallback, cross-build sequencing, folder-vs-glob overlap and the job contract; packer tests for best-hit snippets and outlines.
