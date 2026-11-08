<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md tokens=239 -->
## Removed

- **App tabs plugin** (`apps/console-web/plugins/app-tabs`, Opus build of Oct 19 + the axHub tab of Oct 20 + the
  "banners above the tab group" change of Oct 21 morning): `uninstall.mjs --all` (8 files), its two marked doc lines,
  `node framework/cli/plugin-lifecycle.mjs check app-tabs --after-uninstall` = clean. Its settings keys
  (`app-tabs.tabs|custom|active`) are orphaned in saved console settings; harmless, nothing reads them.
- The console's Apps menu entries *Show … in a tab / Back to the console / App tabs ▸* and action `app-tabs.show:<id>`
  (they came from the plugin's `menu.ts`). The Apps menu still opens Pilot and the hub pages in a new browser tab
  (`console.open:<key>`).
- The hub setting `AXHUB_APPS_FRAME_ANCESTORS=https://console.amberxai.com` is no longer needed for the console
  (nothing frames the hub from the console any more; Patches loads the hub in a web view, which no frame-ancestors rule
  affects).
