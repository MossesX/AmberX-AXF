<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md tokens=131 -->
## Migrations and compatibility
- No data migration. Existing `state.json`, `runs.json` and `roster.json` load as before; `normRoster` adds `fallback: ''`.
- Plugin code importing `./web/swarm-core.mjs` keeps every export it used (`avatarColors`, `post`, `assignLine`,
  `reportLines(run, roster)`, `mergeLines(res, roster)`, `leaseLines(plan, roster)`, `vibeFilter`, …). New code should
  import the framework engines directly.
- `requiredTier` lost its second argument (the skill); `fixerJob` runs on the policy default.
