<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md lines=139-146 tokens=201 -->
## On the VPS

1. After the merge, the console's 5-minute update rebuilds it with the plugin (enabled by default).
2. Once per machine: `node apps/console-web/plugins/codebase-changes/changes.mjs hooks install` (or `bash deploy/claude-pick.sh --install`, which runs it). It writes the absolute path into `~/.claude/settings.json`, so every Claude Code session in every project on that machine reports. <!-- axf-plugin:codebase-changes -->
3. Claude Code runs on the host, where `/projects` isn't mounted: entries go to axHub with the hub token (`claude-sync login` saves it), else to the console with `AXF_TOKEN`; without either they wait in `~/.axf-changes/queue` (`changes.mjs flush` later).

**Other computers:** clone AmberX-AXF, `claude-sync login` (hub token), then the same `hooks install` line.
