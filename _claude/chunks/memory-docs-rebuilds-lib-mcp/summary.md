<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md tokens=352 -->
## Summary

The MCP client is now a **framework library on all three ports** instead of console-only code: one pure engine
(`core/engines/mcp.ts` = Kotlin `kernel/mcp/McpEngine.kt` = Python `axf_libs/mcp/engine.py`, pinned by a shared
fixture `spec/fixtures/mcp-client.json`), one client contract (`McpClient` over a host-implemented transport + <!-- axf-plugin:mcp-client -->
credential provider, so UI code never holds a token), server registries that keep tokens out of records (secure store
on Android, server file on the console, a secret store in browser-only apps), the **outbound call gate** from
INTEROP.md (role must hold `mcp.call` / `mcp.call.write` / `mcp.call.destructive`; destructive tools are confirmed by a
person first), library views on web (MCP servers + Settings → MCP servers) and Compose screens on Android, and the
kernel's first `axf.remote` **RemoteServices** provider. The console plugin was rebuilt in place on the library:
same routes, data file, env vars and behaviour, plus a `prompt` route, plugin-lifecycle@1 and a 24-check self-test.
Headline improvements: cross-port parity (210 fixture/behaviour checks replayed on TS and Python, Kotlin in CI), no
third-party MCP SDK in the request path (stdlib Python, fetch, OkHttp), real cancellation/timeouts/session recovery,
redirects refused (a token never follows one), permission-gated tool calls instead of a bare `confirm()`.
