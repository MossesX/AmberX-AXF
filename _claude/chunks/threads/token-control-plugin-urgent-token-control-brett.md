<!-- memory-chunk@1 source=_claude/THREADS.md lines=91-91 tokens=221 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Token control plugin (Urgent `token-control`; Brett Nov 2 21:38 ET): API + MCP + CLI server/client for every theme/style/layout token (every layout param a token), wired to Claude + axHub; full control of AmberX tasks/to-dos/notes + Plan Studio + orchestrator; interactive docs. s1-s3 Fable, s4-s14 Opus. Folds in amberx-full-mcp-api (don't relaunch it) | waiting (Fable phase s1-s3 done; needs Brett's approval of the Fable → Opus switch, then s4-s14 on Opus) | `claude/token-control` | [#246](https://github.com/MossesX/AmberX-AXF/pull/246) (auto-merge when CI is green; the Opus phase continues on the same branch or a follow-up) | s1 layout tokens, s2 viewport attrs + layout-adopt + check-theme rule, s3 control@1 contract; next: `orchestrator.mjs act approve token-control 1`, then s4 | 2026-11-03 |
