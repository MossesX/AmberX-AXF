<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/app-menu-hooks.md tokens=156 -->
## Known gaps

- **Android twin deferred** (port on hold, Brett Oct 21 2026): `AppMenuEngine.kt`, `AxfRuntime.addAppMenuItems` /
  `registerAppMenuProvider`, `AppMenuConformanceTest`, Compose `AxfMenubar` / `AxfMenuList` with providers, badges,
  checks. The fixture is the contract to port from.
- Live lists are loaded on every open (no caching); a provider decides its own cost.
- `before` / `after` anchors resolve among siblings only; an anchor in another menu is ignored silently (sorted by
  `order` instead).
- Contributed submenu *labels* for created path steps come from the first contribution that creates them.
