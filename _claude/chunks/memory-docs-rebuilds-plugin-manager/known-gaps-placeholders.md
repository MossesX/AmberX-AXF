<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md tokens=180 -->
## Known gaps / placeholders
- Kotlin written without a compiler (engine, host, module, screen, settings screen, conformance test); Android
  screenshots pending CI. Compose previews named `PluginManager_<layout>_<view>` are planned, not yet added.
- Android Plugin Manager has no Install view (no plugin catalog on Android yet) and no logs/files tabs (no server part);
  enable/disable needs a platform `PluginLoader` (`axf.plugins` is still a placeholder capability).
- Android `SettingsScreen` sub-tabs come from `SettingsGroup.tab`; a module can't yet declare a `SettingsTab` of its own
  (pass `extraTabs` to `SettingsScreen`).
- The clash list stays read-only (pending item `plugin-conflicts`, parked as unsafe).
