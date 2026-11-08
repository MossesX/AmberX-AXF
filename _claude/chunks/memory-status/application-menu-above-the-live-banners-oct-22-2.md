<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=128 -->
## Status (as of Oct 21 2026)

- **Application menu above the live banners (Oct 22 2026, Opus; Fable rebuild parked as `menu-above-banners-fable`):** every web app's page is now banner asset → **application menu bar** → live banners (`app.frame.banners`) → `app.frame.top` → layout. `AppShell` renders `MenuBar` in `.fx-frame__menubar` (z-index above the banners so its drop-downs open over them) instead of the layout grid's `menubar` area (an `auto` row, so it collapses). Android twin deferred (PORTING.md).
