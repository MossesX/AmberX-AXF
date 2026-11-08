<!-- memory-chunk@1 source=_claude/THREADS.md lines=102-102 tokens=207 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Theme veto pass (Urgent `theme-veto-pass`; Brett Nov 3 voice): timed pass so token changes skip the axHub veto ("allow theme changes for the next 30 minutes"); grant approved once by Brett, server-side expiry, deletes never covered, banner countdown, audit + undo, read tools read-only, axHub contract | PR open (all 7 steps done; UI Review waiting) | `claude/theme-veto-pass` (on `claude/token-control-opus`; **merge after #250**) | [#262](https://github.com/MossesX/AmberX-AXF/pull/262) | control@1 target `pass.scopes` + `core/engines/control-pass.mjs`; plugin `token-control` 0.2.0 (`lib/pass.mjs`, `web/pass.tsx`); MCP `token_pass_*`; CLI `axf token pass …`; contract CONTROL.md → Veto passes (for axHub build `axhub-veto-pass`) | 2026-11-03 |
