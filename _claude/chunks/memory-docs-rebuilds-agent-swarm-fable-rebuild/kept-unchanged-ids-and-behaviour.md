<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md lines=33-46 tokens=316 -->
## Kept (unchanged ids and behaviour)
- Plugin id `ai.amberx.axf.console.agent-swarm`, folder, `plugin.json` (provides `view:agent-swarm`, `settings-tab:agent-swarm`,
  `service:agent-jobs@1`), lifecycle data dir, env names; `swarm.mjs` commands and `--json` shapes; `jobs.mjs` and the
  `agent-job.mjs` router; the Python server part (reads through the CLI only).
- Data files and their shapes: `agents/roster.json` (swarm-roster@1; gains an optional `fallback`), `agents/skills/*.md`,
  `state.json` (swarm-state@1), `runs.json` (swarm-runs@1 of swarm-run@1), `merges.json`, `pilot-*.json`. Old files load
  unchanged: every normalizer fills defaults and drops junk exactly as before (the fixture pins the outputs).
- agent-card@1: the four starters, `cardModel`, `AgentCard.tsx`, `.fx-idcard` (tokens only). The ID card layout was
  checked and left alone.
- The Breakroom's looks: the avatar draws the same paths with the same classes and tokens, so every screen is pixel
  identical to the Opus build (see Screenshots).
- The banter bank's lines, the presets (All business / Work crew / Break room / Off the rails), the vibe scale 1–500,
  the cussing bands (34 / 67), the drama threshold (30), the chattiness bands (20 / 60), the daily banter budget rule.
