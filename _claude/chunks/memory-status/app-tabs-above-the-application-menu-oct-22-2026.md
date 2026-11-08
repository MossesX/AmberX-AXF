<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=176 -->
## Status (as of Oct 21 2026)

- **App tabs above the application menu (Oct 22 2026, Opus):** new page slot **`app.frame.head`** (React `AppShell`: banner asset → `app.frame.head` → menu bar → banners → `app.frame.top` → layout). The App tabs plugin's bar moved there (its cover now starts where the page starts, under the menu bar and the banners) and Patches web draws its app tabs there (`AppTabs` in `patchesLibrary.tsx`, from the `patches-tabs` nav-menu asset; layout `patches-tabs` 1.1.0 has `slots.nav: []` so they aren't drawn twice). **Build queue Reprocess:** a check that finds nothing to move clears "the queue changed" on Close, so its message goes away. Android twin deferred (PORTING.md).
