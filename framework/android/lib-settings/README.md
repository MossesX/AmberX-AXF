# lib-settings

Settings engine: collects `SettingsGroup`s from `ExtensionPoints.SETTINGS`, stores values in DataStore (secrets in the Keystore-backed store), mirrors them into the kernel Config, emits `axf.settings.changed`, and renders the generated settings interface (`SettingsScreen`) including an Appearance group with every asset slot.

Oct 20 2026: `SettingsScreen` has tabs (Appearance, General, Plugins, About — the web port's ids; a group picks one with `SettingsGroup.tab`), sub-tabs under Plugins for every plugin's group (never a top-level tab), and `InstalledModulesPanel`: every module with its health from the kernel's plugin inventory engine (plugin-inventory@1), opening the Plugin Manager when `PluginManagerModule` (axf-devtools) is installed.

Oct 21 2026: lib-settings registers the `settings` view itself (`AxfUiPoints.VIEWS` → `SettingsScreen()`; `AppShell` merges module
views under the app's), so apps no longer register their own, and a default `help.about` toast built from the manifest
(`<name> <version> on AmberX AXF <framework>.` plus `app.about` when set); an app's own `help.about` replaces it.

Oct 27 2026: `SettingsEngine.remove(key)` and `SettingsEngine.removePrefix(prefix)` delete saved values (DataStore via
`PreferenceStore.removeRaw` / `removePrefix`, SECRET settings in the secure store, the kernel Config user layer through
`Config.remove` / `Config.removePrefix`, and the loaded values), so an uninstalled plugin's settings are deleted rather
than blanked. A blank prefix deletes nothing; secrets under the prefix are found from the still-registered groups.
