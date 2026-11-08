<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md lines=45-59 tokens=272 -->
## Changed

- Server part now imports `framework/python/axf_libs/mcp` (stdlib `urllib`, synchronous, run in a thread pool);
  sessions are still one-per-operation (connect → close) so the routes stay stateless.
- Data file default moved from `.axf-console/mcp-servers.json` to `.axf-console/plugins/mcp-client/mcp-servers.json` <!-- axf-plugin:mcp-client -->
  (plugin-lifecycle@1 `dataDir`); the old path is still read while the new file doesn't exist, and `install.mjs`
  moves it once.
- `connect` adds `sessionId`, `capabilities`, `resourceTemplates`.
- The web part is a host adapter: `createMcpLibrary({ host, envAuth: true, navLabel: 'Plugins', permissions: … })`.
  In the console all four MCP permissions map to `dev.tools` (held by the standard `user` role and hub admins, not by
  the wall's `user`/`themes` roles) — the library's own names (`mcp.*`) are the defaults for apps.
- Destructive tools: a confirm card in the page (library) instead of `window.confirm`; write tools need the write
  permission; denied tools are greyed with the reason.
- Version `0.1.0` → `0.2.0`.
