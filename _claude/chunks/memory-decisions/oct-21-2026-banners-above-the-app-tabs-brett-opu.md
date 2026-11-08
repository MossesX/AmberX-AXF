<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=84-84 tokens=141 -->
## Oct 20 2026 — App catalog on axHub (app-catalog@1)

- **Oct 21 2026 — Banners above the app tabs (Brett, Opus).** Every banner (the banner asset and all `AxfWebLibrary.banners`) sits at the very top of the page, above the app tab group, so it stays visible whichever app tab is open. Framework AppShell order is now: banner asset → `app.frame.banners` slot (`FrameBanners`, scrolls past 45vh) → `app.frame.top` → layout → `app.frame.cover`. The app-tabs cover starts where the bar ends (`--axp-app-tabs-bottom`). Compose AppShell twin deferred (Android hold).
