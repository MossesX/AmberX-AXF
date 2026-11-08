<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/banner-assets.md lines=5-8 tokens=77 -->
## Removed
- Nothing public. The hardcoded `ATTACHABLE_TYPES`/`BANNER_SIDES` literals in `banner.ts` and `BannerEngine.kt` are now derived from the spec (same values exported under the same names).
- `rt.bannerExtra` / `rt.toolbarExtra` private fields (replaced by one `hostExtra` map); no caller used them.
