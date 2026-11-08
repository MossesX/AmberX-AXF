<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md tokens=496 -->
## Contracts, APIs, settings, fixtures (old → new)

| What | Old (Opus plugin) | New |
| --- | --- | --- |
| Protocol core | `mcp` SDK inside the plugin | `mcp-client@1`: engine + client on TS/Kotlin/Python, fixture `mcp-client.json` |
| Capability | none | `axf.mcp` (Kotlin service), `axf.remote` provider (Kotlin `RemoteServices`), web `provides: ['axf.remote.mcp']`, Python service `axf.remote.mcp` |
| Permissions | none (any role could call) | `mcp.servers.manage`, `mcp.call`, `mcp.call.write`, `mcp.call.destructive` (host-mappable; console → `dev.tools`) |
| Web library | — | `ai.amberx.axf.mcp`: view `mcp`, action `mcp.open`, `mcp.reload`, settings tab `mcp`, panel `mcp.servers` |
| Android routes | — | `mcp`, `mcp-servers`; settings group `mcp` on the Connections tab; KV key `axf.mcp.servers`; secure keys `axf.mcp.token.<id>` |
| Plugin routes | `servers`, `servers/{id}`, `connect`, `call`, `read`, `log` | same + `servers/{id}/prompt` |
| Plugin data | `.axf-console/mcp-servers.json` | `.axf-console/plugins/mcp-client/mcp-servers.json` (old path read until moved) | <!-- axf-plugin:mcp-client -->
| Plugin version | 0.1.0 | 0.2.0 |
| Asset types | none | none (library UI uses theme tokens, prefix `axf-mcp`) |

Migration / compatibility: no caller changes. Scripts hitting the plugin routes keep working (fields are a superset).
Existing server records load unchanged (`FileRegistry` is the same file format); run
`node apps/console-web/plugins/mcp-client/install.mjs` (or the Settings panel) to move the file into the data folder. <!-- axf-plugin:mcp-client -->
Apps wanting MCP: web `installLibraries(rt, [createMcpLibrary({ host })])` (or the default `library` with `localHost()`),
Android `McpModule()` + routes in `AppShell`, Python `from axf_libs.mcp import McpClient, UrllibTransport`.
Note: the console's `user`/`themes` wall roles lose MCP access they never should have had (they couldn't reach the
plugin's routes anyway: admin-only unless granted).
