<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-web-settings-notify.md tokens=198 -->
## Other repos

- **axHub** (PR #2, decision #89): reads the mark by convention; inside a host: no brand; `take=settings` drops the
  **Account** link (its settings hook); page mode = page alone; framing by a host opt-in
  (`AXHUB_EMBED_FRAME_ANCESTORS`). 326 tests.
- **Build Pilot** (`feat/patches-settings`): framework re-baked (gets takes + page mode; widget-kind starters it
  lacked added), contract bake reads the Python contracts from `framework/python/axf/contracts/`. typecheck clean,
  contract tests 16, server self-test 283. Merge after AmberX-AXF.
- Console: banner strip talks to a web host through `patches-strip@1` messages (Android bridge unchanged); baked
  framework refreshed. `web-fastapi-wall` template: developer apps attach the hub look (typed through `AxfManifest`).
