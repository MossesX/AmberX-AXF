<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md lines=102-111 tokens=116 -->
## Tests before vs after
| Check | Before | After |
|---|---|---|
| `node apps/console-web/plugins/agent-swarm/test.mjs` | 80 | 87 |
| `npx -y tsx framework/spec/check-swarm.mts` | — | 223 |
| `npx -y tsx framework/spec/check-agent-card.mts` | 61 | 84 |
| `node framework/spec/check-model-policy.mjs` | 12 | 12 |
| `node framework/cli/check-theme.mjs` / `check-controls.mjs` (plugin) | pass | pass |
| `cd apps/console-web && npm run typecheck` | clean | clean |
