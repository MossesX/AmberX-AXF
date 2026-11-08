<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=219-219 tokens=161 -->
## Dock engine, xLayout and unified chrome foundation (Nov 3 2026, dock-engine + xlayout s1–s2, Fable; branch `claude/molly-fable`)

- **xlayout@1** (`framework/core/engines/xlayout.ts`, host-only asset type, `shared: false`; starter `assets/xlayout/molly.json`): the apps Molly frames, chrome merge modes per kind (host | merged | guest; banner host, the rest merged), the IDE block (pane limit, dock-layout preset in force, presets offered, inline tree), three plugin toolbar slots (visible, location, items with `open: main | floating | pane`), guest embed URLs (`guestUrl`: hides + takes). Fixture `xlayout.json`, `spec/check-xlayout.mts`.
