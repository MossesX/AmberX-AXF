<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/widget-assets.md lines=16-27 tokens=543 -->
## Changed
- `framework/core/engines/widgets.ts`: `WIDGET_TYPES`, `ATTACHABLE_ASSET_TYPES` and the two hosts are read from `asset-types.json`; new `HostSpec`, `registerHost/hostSpec/hostSpecs/isHost`, `placeHost(host, data, extra, has, requireHost)` (toolbar keeps the "no toolbar → nothing" rule, banner keeps its "run-time entries still place" rule from the first version), `validateHostAttachments`, `searchBarConfig`, `SEARCH_BAR_MAX_RESULTS`. `placeToolbarWidgets` is now a wrapper.
- `framework/core/runtime.ts`: `attachToToolbar`/`toolbarWidgets` use the generic host store (see banner report).
- React `Widgets.tsx`: `registerWidgetRenderer(type, Component)` open registry; `WidgetView` takes `host` so a renderer can adapt (toolbar vs banner); `SearchBarWidget` uses `searchBarConfig`. `Chrome.tsx` passes `host="toolbar"` and `data-axf-origin`.
- Kotlin `WidgetEngine.kt`: `HostSpec`, host registry (`registerHost`, `hostSpec`, `loadHosts(types, specJson)` called by `AssetTypeRegistry.loadSpecJson`, so a module's own spec file can add hosts), `ownAttachments`, `placeHost`, `validateHostAttachments`, `searchBarConfig`, `SearchBarConfig`.
- Kotlin `SearchEngine.kt`: `SearchFocuser` + `SearchIndex.setFocuser/focusWithUi` (web parity), text-hit dedupe (a page word that names a listed result is dropped, as on the web), `KIND_LABELS` is now mutable with `labelKind()` so modules add their kinds (web: `Object.assign(SEARCH_KIND_LABELS, …)`).
- Kotlin `AxfRuntime.focusSearch(entry)`: runtime fallback (view/text/action/setting/dialog/asset/window) = web `SearchIndex.focus`.
- Kotlin `Models.kt`: `Toolbar.liveSearch` (from `data.search` with `live: true`), so a toolbar asset's live search works on Android like on the web.
- Kotlin `DialogContribution.searchable` (default true; placed before `content` so trailing-lambda callers are untouched) = web `DialogDef.searchable`.
- lib-settings: `axf.settings` search provider (groups + single settings, `requires` carried), action `settings.open:<group>[:<key>]`, `SettingsEngine.focusRequest`; `SettingsScreen` scrolls to the group and filters to the setting on a pick.
- Catalog `k.search`: partial → built.
