<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md tokens=143 -->
## Contract / API / asset / fixture changes
- New record contracts (framework-owned now): agent@1, agent-skill@1, swarm-roster@1 (+ `fallback`), swarm-state@1,
  swarm-job@1, swarm-run@1 (+ `kind`), swarm-report@1. Validators return `{ field, code: missing|invalid, message }`.
- No asset type was added or changed. agent-card@1's schema and starters are untouched; its fixture gained `avatar`.
- Deferred Kotlin twins recorded in `framework/spec/PORTING.md`: `SwarmRules`, `SwarmChat`, `SwarmVibe`, a Compose
  `Avatar` drawing `avatarModel`'s parts (Android on hold).
