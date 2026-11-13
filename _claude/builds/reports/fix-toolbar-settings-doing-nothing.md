# Fix toolbar settings doing nothing

Build `fix-toolbar-settings-doing-nothing` (Phase 1, Opus). Brett, Nov 13 2026:

> when I long-press / right-click a toolbar and open toolbar settings, none of the settings change anything. Selecting
> icons, text, collapsible etc. has no effect. Seen on Shipped features (Sync/CSV/Markdown bar, group-by tabs, filter
> checkboxes, status chips, edit status). Fix it so every toolbar setting actually applies live to that toolbar, on
> every toolbar in the console, persists, and is controllable by API (REST, MCP, CLI, voice). Add a test that changing
> each setting changes the rendered toolbar.

## s1 Why nothing changed (diagnosis)

- Right-click / long-press on any `role="toolbar"` opens the chrome settings dialog (chrome-settings@1,
  `framework/react/components/ChromeContext.tsx`) for instance `slug(data-axf-toolbar | data-axf-toolbar-asset |
  aria-label)`, e.g. `shipped-features-actions`.
- The dialog writes the choice to the setting `axf.chrome.toolbar.<instance>` (`setChromeField`). That part works:
  the value is saved.
- **Nothing reads it.** Only `TabGroup` merges its instance overrides (`chromeInstanceData`). The app toolbar
  (`Chrome.tsx` `Toolbar`) renders straight from the toolbar asset, and the hundreds of page toolbars (plain
  `<div role="toolbar">` in plugins) have no renderer of their own at all. So every toolbar field (Buttons, Align,
  Size, Surface, Rule between groups, Search box, Collapsible) was stored and ignored. Only Tap to confirm worked,
  because `react/tapConfirm.ts` reads the same key.
- Second bug: `setChromeField` drops an override that equals the *app toolbar asset's* value. For a page toolbar that
  meant picking **Icons** (the toolbar asset's default) saved nothing at all, so even a working renderer would not
  have seen it.
