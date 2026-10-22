# lib-mcp

MCP client for any AXF app (`ai.amberx.axf.mcp`). Streamable HTTP only: the app never launches local commands.

- `McpModule()` registers `AxfMcp` (`axf.mcp`) and fills the kernel's `axf.remote` placeholder (`RemoteServices`).
- `McpServerRegistry`: records in the key-value store (`axf.mcp.servers`, mcp-servers@1); tokens only in the platform
  `SecureStore` under `axf.mcp.token.<id>` (Keystore-backed on Android). Records never carry a token.
- `McpClient` over `OkHttpMcpTransport` (no redirects; the credential provider adds the bearer header per server):
  initialize (version negotiation, session id), lists with pagination, tools/call with JSON or SSE replies,
  resources/read, prompts/get, a forgotten session re-initializes once, DELETE on close, coroutine cancellation sends
  `notifications/cancelled`.
- The gate (`AxfMcp.gate` / `callTool`): read tools need `mcp.call`, write tools `mcp.call.write`, destructive tools
  `mcp.call.destructive` **and** `confirmed = true` (the UI asks first); a role without the permission is `denied`.
- Screens: `McpScreen` (route `mcp`) and `McpServersScreen` (route `mcp-servers`); settings group **MCP servers** on the
  Connections tab. Compose previews `McpPreviewServers`, `McpPreviewBrowse`.
- Engine: `ai.amberx.axf.kernel.mcp.McpEngine` (pure Kotlin) = `framework/core/engines/mcp.ts` = `axf_libs/mcp/engine.py`;
  conformance fixture `framework/spec/fixtures/mcp-client.json` (`McpConformanceTest` in the kernel). Unit test here:
  `gradle :lib-mcp:testDebugUnitTest` (MockWebServer).

Written without a compiler (Oct 20 2026): CI compiles it; check the "CI build errors" issue.
