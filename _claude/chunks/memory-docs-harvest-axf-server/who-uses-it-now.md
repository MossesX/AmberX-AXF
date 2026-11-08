<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md lines=20-28 tokens=158 -->
## Who uses it now

- Console core: `main.py` (token file, state, GitHub reads, artifact download), `wall.py`, `credentials.py`, `alerts.py`,
  `app_ci.py`, `app_catalog.py`.
- Plugins (framework import via `import axf_framework`; no cross-plugin imports): activity, agent-manager, ai-assistant,
  claude-badge, console-terminal, container-access, feature-assist, snapshot-manager, systems-check, theme-manager;
  mcp-client through `axf_libs.mcp` (which now uses `axf_server.storage`). Every plugin still passes
  `plugin-lifecycle.mjs check` (project-wizard and session-checkin predate plugin-lifecycle@1 and failed before too).
