<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md tokens=324 -->
## Kept

- Plugin id `ai.amberx.axf.console.mcp-client`, folder `mcp-client`, nav under Plugins, settings sub-tab id `mcp`, <!-- axf-plugin:mcp-client -->
  panel `mcp.servers`, view title "MCP servers".
- Routes (console token every method, 404 when disabled, never on the console MCP): `GET/POST /api/plugins/mcp-client/servers`, <!-- axf-plugin:mcp-client -->
  `DELETE /servers/{id}`, `POST /servers/{id}/connect|call|read`, `GET /log`; request/response shapes (server records
  with `auth`, `envPresent`, `lastCheck`; `connect` → `server`, `instructions`, `protocol`, `tools`, `resources`,
  `prompts`, `resourcesError`/`promptsError`; `call` → `isError`, `content`, `structured`; `read` → `contents`).
- Data format `mcp-servers@1`, `AXF_MCP_SERVERS` and `AXF_MCP_TIMEOUT` (30 s), 0600 file, atomic replace.
- Auth model: `tokenEnv` (preferred) or a stored token typed once; a token never returns to the browser; an unset
  env var → 400; remote failures → 502 with the server's name; the 200-row in-memory call log.
- Server-only mode: the console never launches local commands; Streamable HTTP (http/https) only.
- Every security guard of the Opus build (URL scheme check, id/env-name patterns, length caps, a new server never
  replaces another, text-only rendering of remote content).
