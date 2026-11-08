<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md tokens=339 -->
## Tests

Before (Opus): the plugin had no test file; a scratch smoke script against its server part passed **8** checks
(list/save/token-hidden/bad-url/env-missing/unreachable/log/delete). After: the same 8-check script passes unchanged
against the rebuilt server part, plus
- `npx -y tsx framework/spec/check-mcp.mts` — **210** (155 fixture replay + client against a fake Streamable HTTP
  server: session id, version header, pagination, SSE reply with a notification, forgotten session → one re-init,
  JSON-RPC and HTTP error codes, timeout, abort, 202/HTML/network, cancel notification; local host + fetch transport
  bearer header; tokens never in records).
- `python3 framework/python/axf_libs/mcp/test.py` — **210** (same fixture + a real localhost HTTP server, redirect
  refusal, 0600 file, env var preferred, registry rules).
- `python3 apps/console-web/plugins/mcp-client/test.py` — **24** (routes end to end against a fake MCP server). <!-- axf-plugin:mcp-client -->
- Kotlin: `McpConformanceTest` (kernel, fixture replay) and `McpClientTest` (lib-mcp, MockWebServer) — run by CI.
- Framework checks pass: `axf validate --framework`, `tracker.mjs --check`, `plugins.mjs --check`, `check-theme.mjs`,
  `plugin-lifecycle.mjs check mcp-client` (clean), `framework npm run check:libs`, console `tsc` + `vite build`. <!-- axf-plugin:mcp-client -->
