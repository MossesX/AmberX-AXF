<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md tokens=176 -->
## Removed

- The plugin's own protocol code (`_with_client` on the `mcp` SDK `Client`/`streamable_http_client`, `_dump`,
  `_describe`, `_headers`) — replaced by `axf_libs.mcp.McpClient` + `FileRegistry`. The `mcp` pip package is still
  required by the console (its own MCP *server* `/mcp` uses it); the plugin no longer imports it.
- The plugin's own React views, store and CSS (`web/index.tsx` 390 lines, `web/mcp-client.css`) — replaced by the <!-- axf-plugin:mcp-client -->
  library's views (`framework/libs/mcp/index.tsx`, `mcp.css`, prefix `axf-mcp`), configured by a 60-line host file.
- `globalThis.confirm()` for destructive tools — replaced by an in-page confirm card gated by permission.
