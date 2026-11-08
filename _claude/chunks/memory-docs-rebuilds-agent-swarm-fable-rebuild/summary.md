<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md lines=9-20 tokens=259 -->
## Summary

The agent swarm keeps every feature, route, view, setting and data file of the Opus build. What changed is **where the
truth lives**: the seven swarm records (agent@1, agent-skill@1, swarm-roster@1, swarm-state@1, swarm-job@1, swarm-run@1,
swarm-report@1), the group chat contract and the vibe engine are now **framework engines** under
`framework/core/engines/` with one registry each, normalizers, validators that name the field, JSON Schemas, a registry
snapshot written by `axf schemas`, fixtures under `framework/spec/fixtures/` and one CI check
(`framework/spec/check-swarm.mts`, 223 checks). The console plugin (`apps/console-web/plugins/agent-swarm`) re-exports
them; the check proves the plugin's functions *are* the framework's (never a copy), so the contracts cannot drift again.
Every model choice goes through model-policy@1. The planner, the context packer and the avatar were reviewed and
replaced where the review found them weak. Self-tests: plugin 80 → 87 checks, agent-card 61 → 84, new swarm check 223.
