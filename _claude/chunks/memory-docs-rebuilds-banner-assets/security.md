<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/banner-assets.md tokens=106 -->
## Security
- Guards kept: search results stay UAC-gated (`hide` dropped, `disable` locked and refused on pick with a toast); no new console routes; nothing exposed via MCP.
- Tightened: attachment lists are validated at build time (an asset can no longer carry a malformed `attach` that only shows up as a silent run-time gap). Run-time attachments from a disabled plugin are removed from every host, not only the banner.
