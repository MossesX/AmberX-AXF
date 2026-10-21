# AXF interop — protocol-neutral contracts

How an AXF app talks to the outside world (MCP clients like Claude Code, other AXF apps, the axHub
connector hub, anything later) **without the kernel knowing any protocol**. Every protocol is a module
that contributes a `ProtocolAdapter`; the kernel only owns the contracts below.

Android reference: `framework/android/axf-kernel/src/main/kotlin/ai/amberx/axf/kernel/interop/`.
Web port (`framework/core`): **not yet mirrored** — must be ported with the same names, codes and checks.

## Layers

```
 MCP client ─┐                                          ┌─ lib-mcp      (MCP server + client)
 other app ──┼─▶ ProtocolAdapter ─▶ ProtocolHost ─▶ AxfInterop ─▶ action bus / CallableAction
 axHub ──────┘   (module)           (guarded view)   (kernel)      └─ axf-link   (AXF ⇄ AXF native)
                                                                    └─ lib-hub    (axHub connector)
```

- **Kernel owns:** descriptors, exposure rules, caller model, guarded invocation, audit, `surface@1`,
  wire error codes, adapter lifecycle, and the `axf.jobs` / `axf.remote` capability contracts.
- **Modules own:** wire formats, transports, authentication, and building the `RemoteCaller`.

## Contracts

| Contract | Purpose |
| --- | --- |
| `ActionDescriptor` | Description + JSON Schema `input`/`output`, `effect` (read/write/destructive), `exposure`, extra `requires`, `argOrder`, `longRunning`, `idempotent`, `streams`, `deprecated` |
| `EventDescriptor` | Event topics external subscribers may receive, with exposure and permission |
| `Exposure` | `LOCAL` (default) · `LINKED` (other AXF apps) · `REMOTE` (any adapter). **Default-deny** |
| `CallOrigin` / `RemoteCaller` | Who is calling (`UI`, `APP`, `LINKED_APP`, `REMOTE`), via which protocol, with which grants, plus a correlation id across hops |
| `CallableAction` | Value-returning handler for an action id (plain bus handlers return nothing) |
| `JobManager` (`axf.jobs`) | Long-running external calls: job id, progress, cancel, poll. Typed placeholder |
| `RemoteServices` (`axf.remote`) | Outbound calls from app code to MCP servers / axHub services / other apps through one interface. Typed placeholder |
| `ProtocolAdapter` / `ProtocolHost` | Adapter lifecycle, and the only view of the app an adapter gets |
| `AppSurface` (`surface@1`) | The self-description an app publishes per audience; MCP tools, axf-link pairing and axHub registration are all generated from it |
| `WireError` / `WireCodes` | Stable error codes on every wire, mapped to and from `AxfFailure` |

Extension points: `axf.protocol-adapters`, `axf.action-descriptors`, `axf.event-descriptors`.
Kernel flag: `axf.interop` (default on) starts contributed adapters with the kernel.

## The gate — every external call, in this order

1. A descriptor exists and its exposure reaches the origin kind. Otherwise the result is `not_found`, so LOCAL actions are never revealed.
2. The caller's grants cover `ActionMeta.requires` and `descriptor.requires`. Otherwise `denied`.
3. The app's current UAC role covers them too. Otherwise `denied`. A remote caller can never exceed the local role.
4. The input passes the descriptor's schema check (required fields, top-level types). Otherwise `validation`.
5. A long-running action goes to `JobManager` and returns `{ "jobId": … }`. While `axf.jobs` is still a placeholder, the result is `not_implemented`.
6. The call runs: the `CallableAction` if one exists, otherwise the action bus, with `argOrder` mapped to positional args and the full input in `ActionContext.extras["axf.interop.input"]`.
7. The call is audited with caller, protocol, correlation id and outcome code.

## Wire error codes

`invalid` · `not_implemented` · `denied` · `not_found` · `unavailable` (retryable) · `validation` ·
`unexpected` (message never includes exception text). Reserved for adapters: `cancelled` · `timeout` ·
`confirmation_required`. Unknown codes are read as `unexpected`. Codes never change meaning.

## `surface@1`

```json
{
  "$axf": "surface@1",
  "app": { "id": "notes", "version": "0.1.0" },
  "framework": { "version": "0.2.0", "apiLevel": 1 },
  "audience": "remote",
  "actions": [{ "id": "notes.create", "description": "Create a note", "input": { "type": "object", "properties": { "title": { "type": "string" } }, "required": ["title"] },
                "exposure": "remote", "effect": "write", "longRunning": false, "idempotent": false, "streams": false, "tags": [], "module": "app", "since": "0.2.0" }],
  "events": [],
  "protocols": [{ "id": "mcp", "version": "2025-06-18", "transport": "streamable-http", "direction": "inbound" }]
}
```

## Planned modules on top

- **`lib-mcp`** — MCP client **built (Oct 20 2026, Fable)**: the first `RemoteServices` provider (every registered MCP server is a remote service, its tools are `ActionDescriptor`s with `effect` from the tool annotations). Outbound calls go through the same default-deny idea in reverse: the local UAC role must hold `mcp.call` / `mcp.call.write` / `mcp.call.destructive` for the tool's effect, and a destructive tool is only called once a person confirmed (`confirmation_required` otherwise). Engine `ai.amberx.axf.kernel.mcp.McpEngine` = `core/engines/mcp.ts` = `axf_libs/mcp/engine.py`, fixture `spec/fixtures/mcp-client.json`. The MCP **server** half (actions → tools, `effect` → tool annotations, destructive → `confirmation_required`) is still a placeholder (`axf.mcp.server`).
- **`axf-link`** (`axf-link@1`) — native AXF ⇄ AXF protocol: actions, asset exchange, UAC-aware calls, event subscriptions. Semantics here, transport-agnostic (Android IPC, websocket, via axHub).
- **`lib-hub`** — axHub connector. Registers the app's `surface@1` with the hub and relays hub calls through the gate. The protocol it speaks is **defined by axHub**, not by AXF.
- **`lib-hub-admin`** — a console tab that manages axHub through its public admin API.
