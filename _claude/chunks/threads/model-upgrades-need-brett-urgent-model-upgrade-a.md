<!-- memory-chunk@1 source=_claude/THREADS.md lines=88-88 tokens=179 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Model upgrades need Brett (Urgent `model-upgrade-approval`, Opus; Brett Nov 3, voice: "You can downgrade, but you can't upgrade."; replaces stopped `model-switch-approval`): downgrades pass + recorded; upgrades only by Brett's console click or axHub approval (`axf.orchestrator_upgrade_approve`, confirm); enforced in orchestrator core/CLI/server, launcher (`model-gate.mjs`), swarm planner; audit marked 3 self-approved upgrades + #247's switch | review | `claude/model-upgrade-approval` | #253 | axHub side: set `axf.orchestrator_upgrade_approve` to confirm and forward a signed approval header to downstream (axHub repo) | Nov 3 2026 |
