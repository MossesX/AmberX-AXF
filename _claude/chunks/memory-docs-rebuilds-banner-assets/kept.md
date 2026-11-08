<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/banner-assets.md lines=9-16 tokens=203 -->
## Kept
- Asset types `banner`, `badge`, `clock` in `framework/schemas/asset-types.json`, all fields, enums, defaults, `"optional": true`, `"attachable": true`, `hideable`, roll rules.
- Starters `banner/amberx-thin`, `banner/amberx-accent`, `badge/new`, `clock/digital-12h|24h` (unchanged files).
- `spec/fixtures/banner.json` (byte-identical; `gen-fixtures.mts` regenerates it unchanged).
- Runtime API names on both ports: `assetOrNull`, `attachToBanner`, `detachFromBanner`, `banner()`, `showBannerPopup`, Kotlin `dismissBannerPopup`; `AxfState.bannerPopup`.
- React `Banner`, `BannerBadge`, `BannerClock` exports and every `.fx-banner*` CSS class; `claude-badge` plugin works unchanged.
- Every security guard: UAC gating of search results (hide/disable), no new routes, nothing new reaches the console MCP.
