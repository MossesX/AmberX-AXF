<!-- memory-chunk@1 source=_claude/THREADS.md tokens=248 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Token control plugin (Urgent `token-control`; Brett Nov 2 21:38 ET): API + MCP + CLI server/client for every theme/style/layout token (every layout param a token), wired to Claude + axHub; full control of AmberX tasks/to-dos/notes + Plan Studio + orchestrator; interactive docs. s1-s3 Fable, s4-s14 Opus. Folds in amberx-full-mcp-api (don't relaunch it) | PR open (all 14 steps done; UI Review item r-20261103-f9cd2905 waiting) | `claude/token-control-opus` (contains `claude/token-control`) | [#250](https://github.com/MossesX/AmberX-AXF/pull/250) (+ Fable phase [#246](https://github.com/MossesX/AmberX-AXF/pull/246)); push banner auto-merges when CI is green | plugin `apps/console-web/plugins/token-control`: runner + REST `/api/control` + MCP `control_*`/`amberx_*`/`plan_park` + CLI `axf control/token/note/todo/task/list/plan/build` + JS client + page (Tokens/Try it/Docs/Audit); tests in CI | 2026-11-03 |
