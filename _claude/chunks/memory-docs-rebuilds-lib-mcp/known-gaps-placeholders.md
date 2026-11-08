<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md lines=138-148 tokens=197 -->
## Known gaps / placeholders

- Kotlin written without a compiler (no Maven here): CI compiles `lib-mcp` and runs its tests; check the "CI build
  errors" issue after merge. Android screenshots pending CI (previews `McpPreviewServers`, `McpPreviewBrowse`).
- MCP **server** half (expose `surface@1` actions as tools) — placeholder `axf.mcp.server`. OAuth sign-in to servers —
  `axf.mcp.oauth` (bearer tokens only). Sampling/elicitation — `axf.mcp.elicitation`.
- No resumable GET stream / `Last-Event-ID` (the client only reads the POST response stream); `logging/setLevel`
  not exposed.
- Web `localHost()` default forgets tokens on reload unless the app supplies an `McpSecretStore`.
- `axf.jobs` is still a placeholder, so long-running tools are plain calls bounded by the timeout.
