<!-- memory-chunk@1 source=_claude/THREADS.md lines=93-93 tokens=234 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Headless tabs (Urgent `headless-tabs`, 7 steps, Opus; Brett Nov 3, voice): every console terminal tab lives in a tmux session (re-attach + scrollback replay, Open in Moshi, detach vs Kill session); every headless run opens its own tab with agent · model · live cost + status dot (`deploy/claude-meter.mjs`, model-pricing.json, reconciled to total_cost_usd); split pane with the context chain (CLAUDE.md load order, imports, rules, Reads; rules typed out one at a time) | review (all 7 steps done; PR open, waits for UI Review) | `claude/headless-tabs` | [#259](https://github.com/MossesX/AmberX-AXF/pull/259) | Report `_claude/builds/reports/headless-tabs.md`. Brett: approve UI Review r-20261103-3sp5x01 (group `headless-tabs - Nov 3 9:44 AM`). Console needs a redeploy for tmux in the image. Tests: terminal 97/97, check-headless-tabs 30/30 | 2026-11-03 |
