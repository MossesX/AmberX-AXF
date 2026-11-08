<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-wrapper.md lines=33-39 tokens=104 -->
## Kept

- The page slots the plugin had needed, `app.frame.top` / `app.frame.cover` / `app.frame.banners` (`AppShell.tsx`,
  `Slots.tsx`): other plugins may use them; wording no longer mentions app tabs.
- Every other console plugin, banner and view: pixel-identical standalone (after shot = before shot minus the tab row).
- The web `rebuild-shots.mjs` tool: additive options only (`path`, `userAgent` per shot).
