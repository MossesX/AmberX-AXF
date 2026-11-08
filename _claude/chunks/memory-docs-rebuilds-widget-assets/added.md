<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/widget-assets.md lines=28-35 tokens=360 -->
## Added
- Android `axf-ui/components/Widgets.kt`: `WidgetRenderers` registry, `AxfWidget`, `AxfClock` (minute-aligned ticks, IANA zone via `java.util.TimeZone`, same text as the web through `BannerEngine.formatClock`), `AxfSearchBar` (width = space token × engine number).
- Android `axf-ui/components/Search.kt`: `AxfLiveSearch` (results on every keystroke in an `AxfPopover`, up/down/Enter/Escape on hardware keyboards, IME Search picks, locked hits toast, kind chips), `AxfSearchHost` (views with icons/keywords, dialogs, open windows → index; focuser for windows and the asset gallery), `LocalAxfSearchHost`, `SearchShortcuts` (Ctrl/Cmd+K from `AxfRoot`; `/` deliberately not taken at the root because the root can't tell whether a text field has focus).
- Android `AxfToolbar`: widgets at start/end (`runtime.toolbarWidgets()`), live search when `liveSearch` is set, classic box otherwise.
- Android `AppShell`: `viewIcons`, `viewKeywords`, `dialogs` params; installs the search host.
- Android console: `ConsoleSearch.kt` (tracker items, catalog features → kinds `framework-feature`, `feature`), `MainActivity` passes view icons + keywords.
- Fixtures `widgets.json` + `hosts`, `attachableTypes`, `searchBarConfig` (6 cases incl. clamping, bad enums, bad kinds, non-boolean shortcut), `attachValidation` (6 cases); `validation.json` + 3 host cases. `check-widgets.mts` (web, CI) and the Kotlin `ConformanceTest` replay all of them.
