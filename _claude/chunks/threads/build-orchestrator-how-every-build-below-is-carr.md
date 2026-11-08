<!-- memory-chunk@1 source=_claude/THREADS.md lines=550-553 tokens=144 -->
### Build orchestrator (how every build below is carried on)
- Tracker: `_claude/builds/orchestrator.json` (orchestrator@1; how-to `_claude/builds/README.md`). `node orchestrator.mjs next` says what to do; `brief <id>` gives the current phase only. At a Fable ↔ Opus switch, stop and ask Brett (card), then `act approve <id> <phase>`. <!-- axf-plugin:build-orchestrator -->
- **First message (any build):** "Run `orchestrator.mjs next` and continue that build from `_claude/builds/orchestrator.json` on the model its next phase names." <!-- axf-plugin:build-orchestrator -->
