<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=31-31 tokens=68 -->
## Dev Console

- Oct 18 2026: plugin settings are **sub-tabs of Settings → Plugins**, never top-level settings tabs (all five plugins moved; the console enforces it). The settings contract gained `SettingsTab.parent` (web + Kotlin) and the settings view a sub-tab row.
