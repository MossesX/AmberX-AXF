<!-- memory-chunk@1 source=_claude/THREADS.md lines=64-64 tokens=204 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Plugin lazy loader (Current `plugin-lazy-load`, Opus; agent Janitor Joey, no Polo card; Brett Nov 3 voice: "The console gets slower as more plugins are installed" + "banners need to be the very first thing to load"): one chunk per plugin, stand-ins from cached shapes so menus / routes / commands exist at startup, banners first, Lazy loader settings in Plugin Manager (preload count, pins, order, idle, LRU cache, offline cache, per-plugin Start/Open/Off, live table) + REST/MCP/CLI `/lazy` | landing (`urgent-land-lazy-loader`) | `claude/plugin-lazy-load` | #298 | main merged in, banners seeded, tsc + vite + 87 checks pass; startup 4.46 → 2.07 MB; waiting on CI → merge → console auto-update. UI Review shots still owed | 2026-11-04 |
