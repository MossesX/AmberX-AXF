<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal-fable.md lines=80-91 tokens=258 -->
## Compatibility notes for apps

- Re-baked in this step (framework → `src/axf`): **console-web, axhub-web, walkthrough-studio, amberx-droid, demo** — all
  typecheck and build. **patches-web is left alone** (Patches paused, its baked copy stays).
- `apps/demo` was on a pre-banner framework: its `axf.manifest.json` `defaults` now carry every slot added since
  (merged from `framework/defaults.json`, the demo's own picks kept) and the missing starter asset folders were copied in,
  otherwise `AxfManifest` no longer typechecked. 39 → 446 assets, `axf validate` passes.
- Apps that open floating windows get resize handles and maximize for free; a window that must stay inside the viewport
  should set `minWidth` / `minHeight` and its own snap rules (`setSnapRules`), as the engine no longer clamps.
- Any app settings asset still naming `pro` / `advanced` keeps working (migrated on read); update it at leisure.
- Plugins that drew their own level picker should drop it: the toolbar comes from lib-settings on every interface.
