<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/widget-assets.md lines=55-57 tokens=58 -->
## Security
- Search results stay UAC-gated on Android exactly as on the web (`SearchIndex.query` drops `hide`, marks `disable`; the UI refuses a locked pick). Settings entries carry their `requires`. No new routes, nothing on MCP.
