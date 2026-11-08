<!-- memory-chunk@1 source=_claude/memory/docs/plugin-theme-override.md lines=11-22 tokens=347 -->
## What was built

| Part | Where |
|---|---|
| Pure part: token registry (4 groups), value checks, set / reset / merge, tri-state, search, JSON in/out, copy from theme assets, CSS | `framework/libs/plugintheme/core.ts` |
| React part: `withPluginTheme`, `PluginScope`, Appearance panel (form, token tree, JSON, copy, reset, preview), `pluginThemeLibrary` (stylesheet, actions, right-click, toolbar button) | `framework/libs/plugintheme/index.tsx`, `plugintheme.css`, `library.json` |
| Settings tab scope: `SettingsTab.plugin` → `TabContent` wraps the tab in `data-axf-plugin` (Settings, the plugins browser, Banner settings, page mode) | `framework/core/settings.ts`, `framework/libs/settings/index.tsx` |
| Framework controls: `Checkbox indeterminate` (tri-state), `ColorField` (picker + text: hex, rgb(), `var(--fx-…)`); `.fx-plugin-scope { display: contents }` | `framework/react/components/Forms.tsx`, `framework/ui/axf.css` |
| Console wiring: `underPlugins` wraps every plugin with `withPluginTheme({ id: manifest.id, name })`; `pluginThemeLibrary` installed with the built-ins | `apps/console-web/src/App.tsx` |
| Application menu: Plugins ▸ All plugins ▸ <plugin> ▸ **Theme override** (check mark) | the Plugins menu plugin's ladder (`themeToggle`, `themeCounter` in its `web/core.ts`) |
| Self-tests | `framework/spec/check-plugintheme.mts` (54), `plugins-menu/test.mts` (46) |
