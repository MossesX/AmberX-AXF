<!-- memory-chunk@1 source=_claude/THREADS.md tokens=201 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Console wake (Urgent `console-wake`; Brett Nov 3 voice; agent Ping Paulie): console commands always reach a console: queue per user (2 min) + deliver once on reconnect, MCP waits up to 60 s, no `bye` on React cleanup (cause of the in-console drop), wake via AmberX (`amberx.open_url` → console.amberxai.com/?axf-cmd=<id>), settings + toast + delivery.how. Opus | PR open, UI review waiting (all steps done) | `claude/console-wake` (+ axHub `claude/amberx-open-url`) | [#266](https://github.com/MossesX/AmberX-AXF/pull/266) · [axHub #35](https://github.com/MossesX/axHub/pull/35) | auto-merge when CI green + UI Review approved; **install the new AmberX APK** on Brett's phone for the wake path (checklist-one) | 2026-11-03 |
