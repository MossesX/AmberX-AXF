<!-- memory-chunk@1 source=_claude/THREADS.md lines=82-82 tokens=199 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Scrollable menus that stay on screen (Urgent `menu-scroll`, Opus; Brett Nov 3 voice: "The application menus need to be scrollable when they reach beyond the screen."; agent Janitor Joey): menu-fit@1 engine (`core/engines/menufit.ts`) + `react/components/menuFit.ts`; app menu drop-downs, submenus, context menus and plugin ⋯ menus flip / shift to stay on screen (visual viewport, safe areas, keyboard) and scroll inside with fade + chevron hints; browser checks 7/16 → 16/16 | PR open (UI Review waiting) | `claude/menu-scroll` | [#268](https://github.com/MossesX/AmberX-AXF/pull/268) (UI Review r-20261103-2637fd91) | Android twin deferred (PORTING.md). Report `_claude/builds/reports/menu-scroll.md` | 2026-11-03 |
