<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md tokens=260 -->
## Migrations / adoption

- **Build Pilot** (separate repo): re-bake the framework (`scripts/bake-contracts.mjs` / its `src/axf` copy) to get
  `embed.ts` + the runtime change; nothing else — its AppShell is the framework's. Until then Pilot keeps its banner inside
  Patches' Pilot tab.
- **axHub** (separate repo, not AXF): optional — read the same marker (`AXF-Embed/<host>` in the user agent, or
  `?axf-embed=`) and hide its own header, if Brett wants the hub tab bannerless too.
- **Hub**: `AXHUB_APPS_FRAME_ANCESTORS=https://console.amberxai.com` can go.
- **Pending list on the hub**: the copy `axhub.memory_read(project amberx-axf, data, framework/plan/pending.json)` held
  **10 items** (first version 14:07 UTC today, written over MCP) while the repo snapshot holds **21** with every
  sub prompt and estimate. Something wrote a short list over the hub's. This build added `patches-wrapper` to the **repo
  snapshot** only; on the VPS run `claude-sync status` and keep the right copy before the console's Pending view is trusted.
