# Plugin theme override (Oct 28 2026)

Brett (Oct 28 2026): every plugin UI, not only floating ones, gets a theme override over the axHub theme: a collapsible
container in the plugin's Appearance tab with every layout / colour / style / animation token, several editing views,
switchable from right-click, the toolbar and the application menu.

Built on **Opus** as refactor-all s72–s75 (group `plugin-theme-override`), branch `refactor-all/plugin-theme`. Brett
**skipped** the Fable steps (refactor-all s68–s70: plugin-theme@1 contract, scoped engine + fixture, React layer), so
this is a web library on what already exists, not a cross-port contract. Android: deferred (`framework/spec/PORTING.md`).

## What was built

| Part | Where |
|---|---|
| Pure part: token registry (4 groups), value checks, set / reset / merge, tri-state, search, JSON in/out, copy from theme assets, CSS | `framework/libs/plugintheme/core.ts` |
| React part: `withPluginTheme`, `PluginScope`, Appearance panel (form, token tree, JSON, copy, reset, preview), `pluginThemeLibrary` (stylesheet, actions, right-click, toolbar button) | `framework/libs/plugintheme/index.tsx`, `plugintheme.css`, `library.json` |
| Settings tab scope: `SettingsTab.plugin` → `TabContent` wraps the tab in `data-axf-plugin` (Settings, the plugins browser, Banner settings, page mode) | `framework/core/settings.ts`, `framework/libs/settings/index.tsx` |
| Framework controls: `Checkbox indeterminate` (tri-state), `ColorField` (picker + text: hex, rgb(), `var(--fx-…)`); `.fx-plugin-scope { display: contents }` | `framework/react/components/Forms.tsx`, `framework/ui/axf.css` |
| Console wiring: `underPlugins` wraps every plugin with `withPluginTheme({ id: manifest.id, name })`; `pluginThemeLibrary` installed with the built-ins | `apps/console-web/src/App.tsx` |
| Application menu: Plugins ▸ All plugins ▸ <plugin> ▸ **Theme override** (check mark) | `apps/console-web/plugins/plugins-menu/web/core.ts` (`themeToggle`, `themeCounter`), `web/index.tsx` |
| Self-tests | `framework/spec/check-plugintheme.mts` (54), `plugins-menu/test.mts` (46) |

## Storage shape (what a contract should adopt)

One setting per plugin, only what the person changed:

```json
axf.plugin.<pluginId>.look = {
  "on": true,
  "tokens": { "--fx-space": "10px", "--fx-accent": "var(--fx-info)", "--fx-motion": "240ms" }
}
```

- `pluginId` = plugin.json `id` (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`). No setting = off, nothing changed (a reset to
  nothing removes the setting).
- `tokens` keys are theme variables from the open registry `PLUGIN_THEME_TOKENS` (layout: space, card / tab padding,
  row height; colour: every colour-theme colour; style: fonts, text size, heading weight / tracking, radii, border width,
  shadows, blur, the six opacities; animation: motion duration, easing). Values are CSS text, checked per kind:
  lengths / numbers / times clamped and snapped (`12px`, `0.6`, `240ms`; `calc(…)` and `var(--fx-…)` allowed), colours
  as hex / rgb / hsl / color-mix / `var(--fx-<colour>)` (a reference follows a colour-theme swap), choices as safe text.
  Anything with `; { } < > \ @ url(` is dropped.
- Last save wins (one key per plugin); every editor re-reads on focus (`useEditorSync`).

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

## Known gaps

- Derived tokens declared on `:root` from other tokens (`--fx-card-pad`, `--fx-tab-py/px` = `calc(var(--fx-space) * k)`)
  are resolved at the root, so overriding `--fx-space` doesn't move them; they are separate tokens in the registry.
  Component-engine variables (button, slider, …) aren't overridden yet.
- UI a plugin renders into a portal outside its roots (`document.body`), its banners and its slot content don't carry the
  attribute (banners have their own look@1 in Banner settings; wrapping slots / banners would break their hosts' child
  selectors).
- No per-level (Simple / Basic / Developer / Administrator) placement for the panel's tokens.
- Android: none (on hold).

## How a Fable contract (plugin-theme@1) would replace it

1. Contract: keep `{ on, tokens }` under `axf.plugin.<id>.look` (add `$axf: "plugin-theme@1"` when written, read the
   frame-less shape as v0), the token registry moves to `framework/schemas/` (one source for both ports), value rules
   become the contract's normalizer.
2. Scoped engine: `core/engines/plugintheme.ts` + Kotlin twin replacing `normalizePluginLook` / `pluginThemeCss`,
   fixture `spec/fixtures/plugin-theme.json` (cases from `check-plugintheme.mts`); it can also re-derive card / tab
   padding and component variables inside the scope.
3. React layer: the runtime marks plugin roots itself (instead of the console's `withPluginTheme` wrapper) and the
   lib's UI becomes the editor on top of the engine. The Opus version is removed by deleting `framework/libs/plugintheme`
   and the `withPluginTheme` / `pluginThemeLibrary` lines in `apps/console-web/src/App.tsx`; stored settings stay valid.
