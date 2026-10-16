# lib-settings

Settings engine: collects `SettingsGroup`s from `ExtensionPoints.SETTINGS`, stores values in DataStore (secrets in the Keystore-backed store), mirrors them into the kernel Config, emits `axf.settings.changed`, and renders the generated settings interface (`SettingsScreen`) including an Appearance group with every asset slot.
