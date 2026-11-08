<!-- memory-chunk@1 source=_claude/THREADS.md tokens=129 -->
### Crew retrain (`crew-retrain`)
Done (PR open). If a later session must carry on: read `_claude/builds/reports/crew-retrain.md` (Known gaps: crew pay under the $40 feature-build cap; old console sweep until it lands). Land it after land-everything's other PRs. Checks: `node <console plugins>/agent-swarm/test.mjs`, `npx -y tsx framework/spec/check-job-type.mts`, `npx -y tsx framework/spec/check-swarm.mts`, `node framework/spec/check-agent-slots.mjs`, `node framework/cli/plugin-lifecycle.mjs check agent-swarm`.
