# lib-settings

Settings engine: collects `SettingsGroup`s from `ExtensionPoints.SETTINGS`, stores values in DataStore (secrets in the Keystore-backed store), mirrors them into the kernel Config, emits `axf.settings.changed`, and renders the generated settings interface (`SettingsScreen`) including an Appearance group with every asset slot.

Oct 20 2026: `SettingsScreen` has tabs (Appearance, General, Plugins, About — the web port's ids; a group picks one with `SettingsGroup.tab`), sub-tabs under Plugins for every plugin's group (never a top-level tab), and `InstalledModulesPanel`: every module with its health from the kernel's plugin inventory engine (plugin-inventory@1), opening the Plugin Manager when `PluginManagerModule` (axf-devtools) is installed.
