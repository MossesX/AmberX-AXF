<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=157 -->
## Dock engine, xLayout and unified chrome foundation (Nov 3 2026, dock-engine + xlayout s1–s2, Fable; branch `claude/molly-fable`)

- **chrome@1** (`framework/core/engines/chrome.ts`): guests send menus / nav / context menus / toolbars / banner widgets as data (`ChromeBundle`, `parseChromeBundle`), the host merges under `<app>:<id>` (`mergeChrome`) and routes picks back (`routePick`). embed@1 takes `nav-menu` / `context-menu` / `toolbar` / `widgets` (web + Kotlin registry), messages `chrome` / `chrome-request`; runtime guest side `rt.shareChrome()` + `runSharedMenuItem`. Fixture `chrome.json`, `spec/check-chrome.mts`.
