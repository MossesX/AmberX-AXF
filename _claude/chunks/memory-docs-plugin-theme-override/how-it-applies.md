<!-- memory-chunk@1 source=_claude/memory/docs/plugin-theme-override.md lines=44-57 tokens=313 -->
## How it applies

- Every plugin UI root carries `data-axf-plugin="<pluginId>"` (a `display: contents` wrapper around each view, dialog,
  window / tab-group tab renderer and settings panel; `TabContent` for its settings tab).
- One `<style id="axf-plugin-theme">` holds `[data-axf-plugin="<id>"]{--fx-…:…}` for every override that is on (plus
  `color` / `font-family` / `font-size` when text, font or size changed). The app / axHub theme, the app-wide look@1
  sliders and theme swaps stay the base; the appearance lock (`rt.appearanceLocked()`) sets every override aside.
- The editor (`data-axf-plugin-editor`) always gets the app's own values back (captured on `body` as `--axfpt-base-*`),
  so an unreadable override can still be reset; its preview carries the plugin attribute again.
- Counter `plugin-theme.on:<id>` is 1 while on (menu check marks). Actions `plugin-theme.toggle[:<id>]`,
  `plugin-theme.edit[:<id>]` (no id = the plugin last pointed at, else the plugin whose page is on screen).
- Right-click inside a plugin UI: `rt.contextExtras` `*:plugin-theme` (the clicked element's `data-axf-plugin`, tracked
  in the capture phase). Toolbar: action-button `plugin-theme`, attached at run time (`axf.pluginTheme.toolbar`, default on).
