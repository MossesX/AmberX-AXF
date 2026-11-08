<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md lines=20-26 tokens=104 -->
## Removed
- The Opus plugin folder (via its own uninstall script) and its doc lines; the in-plugin copy of the provider
  catalog (`providers.CATALOG` literal) and the duplicated rule code (`_wire_history`, `_SECRET`, `_settings_for`,
  param clamps) — now read from the shared registry / `contract.py`.
- The fixed `HOSTS` list in `sessions.py` (replaced by the registry below).
- Nothing user-visible was removed.
