<!-- memory-chunk@1 source=_claude/memory/docs/chain-control.md lines=22-30 tokens=272 -->
## What a launch does
Before each session the launcher runs `chain-control.mjs plan`:
- **Chain:** `always` files go in the system prompt, `demand` files are named, `never` files are left out. Every file `always` in load order means Claude Code loads its own chain. If no rules at all would reach the run, it loads its own chain too: never rules-free.
- **Sessions:** `per-step` runs a fresh session per open step, `per-phase` one per model, `per-build` one for the whole build. Each fresh session opens with a handoff note from the progress file (build-progress@1), the step, its checks and its files.
- **Loop stops** when every step is done, a step is left open, a budget stop fired, or the next step is pinned above the run's model.
- **Output caps:** `BASH_MAX_OUTPUT_LENGTH`, `MAX_MCP_OUTPUT_TOKENS`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`. 0 leaves Claude Code's limit.
- **Budget:** counts input + output + cache writes per session; cache reads are left out. Warn prints one line, stop ends the session.
- `AXF_CHAIN_CONTROL=off` skips all of it and runs the rules brief alone.
