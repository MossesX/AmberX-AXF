<!-- memory-chunk@1 source=_claude/THREADS.md tokens=171 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| AmberX AI connection: fix Save key + several Claude tokens (Test each, primary) | done | `claude/amberx-claude-tokens` | [#157](https://github.com/MossesX/AmberX-AXF/pull/157) | Merged Oct 28; amberx.amberxai.com picks it up on the 5-minute update. Save never reached the server; errors now show next to the button. New Claude plan tokens list: add name + access + optional refresh (saved and tested in one tap), Test / Test all, star = primary. Server `POST /api/ai/profiles`, `POST /api/ai/primary/{id}`; 141 server tests pass. Orchestrator build `amberx-claude-tokens` (refactor, Opus) | 2026-10-28 |
