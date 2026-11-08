<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md tokens=103 -->
### Build Pilot
- Framework re-baked (new `scripts/rebake-framework.mjs`, `axf.lock.json` rewritten the `axf init` way, 101 files;
  `bake-contracts.mjs` re-run on top). Manifest `developer.hub`; `main.tsx` attaches the source (`VITE_AXF_HUB` override).
  Look plugin: "Use this look everywhere" applies the picked colour/style/layout to Build Pilot itself through
  `rt.swapAll`, which writes them to the hub.
