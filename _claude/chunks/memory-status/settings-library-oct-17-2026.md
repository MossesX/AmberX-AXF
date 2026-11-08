<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=129 -->
## Status (as of Oct 21 2026)

- **Settings library (Oct 17 2026):** `framework/libs/settings` (web, id `ai.amberx.axf.settings`): tabs Appearance, Account & security, Connections, Plugins, About; libraries/plugins contribute `settings` groups, `settingsPanels` and `settingsTabs` via `AxfWebLibrary`. Contract in `framework/core/settings.ts` mirrors Android `SettingsGroup`/`SettingSpec` (Android got the matching `tab` field). The console installs it as a built-in; its plugin manager is now Settings → Plugins.
