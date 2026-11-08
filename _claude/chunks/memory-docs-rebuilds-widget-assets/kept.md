<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/widget-assets.md lines=8-15 tokens=182 -->
## Kept
- Asset type `search-bar` (fields, enums, optional fields), `"widget": true` on clock + search-bar, group "Widgets".
- Starters `search-bar/everything` (default), `search-bar/compact`; both banners keep `everything` in the centre.
- `toolbar.widgets` field and `toolbar.search.live`; Ctrl/Cmd+K and `/` on the web.
- Runtime names on both ports: `attachToToolbar`, `detachFromToolbar`, `toolbarWidgets()`; React `WidgetView`, `SearchBarWidget`, `LiveSearch`, `useSearchHost`; CSS `.fx-widget-search`, `.fx-toolbar__widget`.
- `apps/console-web/src/consoleSearch.ts` providers (plan features, tracker, pending builds, plugins) unchanged.
- `spec/fixtures/widgets.json` and `search.json` existing entries byte-identical.
