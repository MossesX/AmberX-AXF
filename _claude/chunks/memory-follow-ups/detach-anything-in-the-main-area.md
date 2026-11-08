<!-- memory-chunk@1 source=_claude/memory/follow-ups.md tokens=151 -->
## Nov 3 2026 - queued after the feature freeze (CI green + merge everything first)

- **Detach anything in the main area** (Brett, voice: "Yeah, I want to be able to detach anything in the main area."): every page/screen/plugin view open in main gets a Detach button (and context-menu 'Detach' + drag the tab/title out) that pops it into its own floating, resizable window, with 'Dock back'. Fold in pending item `plugin-floatable` (plugin@1 `floatable` field, ~55 min / ~$15) and make detach the framework default for every page, existing and future. Same build as the settings-interface detach above.
