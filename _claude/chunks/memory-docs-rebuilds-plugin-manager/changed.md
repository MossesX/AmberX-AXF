<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md tokens=663 -->
## Changed
- **Model = framework engine.** `web/model.ts` types now extend the engine's `PluginInventoryItem`; the browser
  re-resolves the server's records together with the bundle's web contributions (view/dialog/settings-tab ids) through
  the same engine, so web-only clashes are reported by the engine (kind `contribution`) instead of a separate
  `web-contribution` kind. Offline (no console API) the bundled manifests go through the engine too, so offline rows now
  show real dependency statuses for everything the manifests declare (before: everything was `declared`).
- Dependency kinds gained **`plugin`** (`requires: ["plugin:<id>"]`, what Android modules' `dependsOn` map to), shown in
  the Detail → Dependencies tab under "Plugin" and counted in "needs N". `dependents` are de-duplicated per
  (plugin, service).
- Dependency detail wording says "the host" instead of "the console" (the same strings on every port).
- `inventory.py` responses carry `"frame": "plugin-inventory@1"`; the server's `TARGET`/`API_LEVELS` are explicit, and a
  plugin whose `targets` don't include `axf-console` is reported `blocked` with a framework dependency `target axf-console`.
- plugin.json version 0.1.0 → 0.2.0, `builtWith.model` = fable; the web library declares `uiEditor: ['manager']` too.
- Framework `rt.libraries` entries are now `InstalledLibrary` records (id, label, version, template, `dependsOn`,
  `provides`, `uiEditor`, `contributes`, `ui`), built by `installedLibraryRecord` in `framework/react/library.ts`;
  `AxfWebLibrary` gained an optional `uiEditor`.
- Settings library (`framework/libs/settings`) Plugins tab panel "Installed libraries" → "Installed plugins and
  libraries": health chip, "used by N", a Settings button per library with a tab, Details / Open the Plugin Manager when
  that plugin is installed, clash summary.
- Android `lib-settings` `SettingsScreen`: tabs (Appearance, General, Plugins, About; `SettingsTabs`), sub-tab row under
  Plugins (a plugin's own tab id becomes a sub-tab there, never top-level), `InstalledModulesPanel` on the Plugins tab.
- Templates: `react-ts`/`next-ts` `App.tsx` install `libs/settings` through `installLibraries`; `android-compose` App.kt
  adds `PluginManagerModule`, MainActivity registers `settings` and `plugin-manager` views; template.json/READMEs
  document it. Starter assets: every nav-menu (`icon-rail`, `pill-tabs`, `sidebar-list`) and app-menu (`developer`,
  `minimal-picker`, `standard-desktop`) has a **Settings** item; `app.settings` joined `STANDARD_ACTIONS` on the web
  (Kotlin already had it). `spec/fixtures/menu-filter.json` regenerated (the new item only).
