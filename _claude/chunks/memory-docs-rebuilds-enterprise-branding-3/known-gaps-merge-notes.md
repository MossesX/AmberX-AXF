<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/enterprise-branding-3.md tokens=130 -->
## Known gaps / merge notes
- `refactor-all/veto` (approvals banner held rows) and `refactor-all/plugin-theme` (plugin theme override) are not in this base: expect conflicts in `approvals-banner/web/approvals-banner.css` (root rule), `framework/ui/axf.css` (banner section), the re-baked `src/axf` copies and `axf.lock.json` files (re-bake again after merging), and plugin page heads / settings panels. Keep the held-row feature.
- Android twins deferred (PORTING.md). The Brand library is console-only (not in AmberX).
