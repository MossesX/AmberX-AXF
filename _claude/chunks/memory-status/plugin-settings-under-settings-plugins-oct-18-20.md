<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=180 -->
## Status (as of Oct 21 2026)

- **Plugin settings under Settings → Plugins (Oct 18 2026, built on Opus):** `SettingsTab.parent` (web `core/settings.ts`: `topTabs()`, `subTabs(parent)`, `getTab(id)`; `listTabs()` still lists all so search indexes sub-tabs; Kotlin `SettingsTab` data class in `contract/Contracts.kt`, written without a compiler). The settings view shows a sub-tab row under a tab that has children (Plugins: "All plugins" + one per plugin); `settings.open:<sub-tab id>` opens parent + child and the last pick is remembered. The console's `underPlugins()` (`src/App.tsx`) sets `parent: 'plugins'` on every tab a plugin contributes, so every plugin's settings are a Plugins sub-tab whatever it declares.
