<!-- memory-chunk@1 source=_claude/memory/docs/token-log.md tokens=126 -->
## Lean headless launches
`deploy/claude-headless.sh` sets `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and passes the composed rules brief with
`--append-system-prompt`, so it sits in the cached system prompt and survives compaction. The chain is dropped only once a
brief exists: no brief, lean off, or a failed CLI means the run loads the full chain. `AXF_LEAN_HEADLESS=off` forces it.

Measured on this repo, Opus 5.5, a one-line prompt, first turn: full chain 69,931 context tokens, $0.47; lean 30,057, $0.15.
