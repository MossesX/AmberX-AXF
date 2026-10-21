# Web libraries

Libraries for the web port (React/TypeScript), one folder each, generated from `framework/library-templates` by
`axf new-library … --ports web` or `axf port-library <slug> --to web`. Each exports `library: AxfWebLibrary`
(`framework/react/library.ts`); apps merge them with `installLibraries(runtime, [...])`.
Type-check them all: `cd framework && npm install && npm run check:libs` (what `axf compile-library` runs).

Every library with UI must conform to the theme engines and follow the naming principles in
`framework/spec/THEMING.md` (prefix `axf-<library>`). CI checks it with `node framework/cli/check-theme.mjs`.

## settings (`ai.amberx.axf.settings`)

Hand-written, schema-driven Settings page (web port of `framework/android/lib-settings`). Tabs: Appearance,
Account & security, Connections, Plugins, About. Other libraries and plugins add to any tab through their
`AxfWebLibrary`: `settings` (groups of `SettingSpec`, rendered as controls), `settingsPanels` (custom UI) or
`settingsTabs` (new tabs). The contract lives in `framework/core/settings.ts` (same shape as the Android
`SettingsGroup` / `SettingSpec`); values persist per app in localStorage, `secret` values never do.
Install it with `installLibraries(rt, [settingsLibrary, ...])`; open it with `app.settings` or `settings.open:<tab>`. Every
`axf init` app ships it (the templates install it in `App.tsx`; the starter nav and app menus have a Settings entry). The
**Plugins** tab lists every installed library with its health, dependents and clashes from the plugin inventory engine
(`framework/core/engines/plugins.ts`, plugin-inventory@1, via `framework/react/pluginRecords.ts`), and opens the Plugin
Manager when that plugin is installed. Plugins never ship a settings screen of their own: they add groups, panels or
sub-tabs under Plugins.

## alerts (`ai.amberx.axf.alerts`)

Developer alerts for any AXF app. Engine: `framework/core/engines/alerts.ts` (alert@1: one alert per key, repeats bump
the count, worse severity escalates, resolved alerts reopen; delivery rules per channel with per-source overrides),
mirrored by the Kotlin kernel's `AlertEngine` and the console server's `alerts.py`; all three replay
`spec/fixtures/alerts.json`. The runtime reports **diagnostics** (`rt.diagnostics`: two modules registering the same asset
id, setting key or settings tab/group/panel, and crashes), which the library turns into alerts.

The library adds the **Alerts** view (action `alerts.open`), keeps the counter `alerts.unread` that toolbar items show
with `badge: "alerts.unread"`, a **Settings → Alerts** tab (where alerts go, sources, ntfy, web push, a test) and catches
page crashes. Where alerts live is a transport: `localTransport()` (this browser, bell only) by default, or the app's own
(the Dev Console's talks to `/api/alerts`). Web push needs the service worker served as a real file:
`alertsServiceWorker()` from `./alerts/vite-plugin.mjs` + `createAlertsLibrary({ transport, serviceWorkerUrl: '/alerts-sw.js' })`.
Self-test: `npx -y tsx framework/spec/check-alerts.mts`.

## mcp (`ai.amberx.axf.mcp`)

MCP client for any AXF app (Fable, Oct 20 2026). Protocol core: `core/engines/mcp.ts` (pure: JSON-RPC framing, SSE
parsing, Streamable HTTP rules, pagination, wire-error mapping, tool effects + the outbound call gate) and
`libs/mcp/client.ts` (`McpClient` over an `McpTransport` the host implements, so UI code never holds a token:
initialize/negotiate, session id, lists with pagination, tools/call with JSON or SSE replies, resources/read,
prompts/get, forgotten-session retry, cancel, timeouts, DELETE on close). Mirrored by the Kotlin kernel's
`ai.amberx.axf.kernel.mcp.McpEngine` + `lib-mcp`, and Python `axf_libs/mcp`; all three replay
`spec/fixtures/mcp-client.json`. Self-test: `npx -y tsx framework/spec/check-mcp.mts`.

The library adds the **MCP servers** view (nav, action `mcp.open`: connect, browse tools/resources/prompts, call tools
with JSON args — write tools need `mcp.call.write`, destructive ones `mcp.call.destructive` and a confirmation — call
log) and **Settings → MCP servers** (`mcp`, panel `mcp.servers`; `mcp.servers.manage` to edit). What it talks to is an
`McpHost` (`libs/mcp/host.ts`): `localHost()` keeps records in localStorage and tokens in an `McpSecretStore` you supply
(browser-only apps); the Dev Console passes a host that proxies to its server so tokens stay there.
`createMcpLibrary({ host, envAuth, navLabel })`.

## hub (`ai.amberx.axf.hub`)

axHub connector, first slice (Opus, Oct 20 2026 harvest). A plain module (no UI): `libs/hub/hub.ts` has the hub address
rules (`normalizeHub`, `hubOrigin`, `isHub`: https host only, links checked against that exact origin), hub URLs
(`approvalsUrl`, `approvalUrl(base, id)` only for real ids, `loginUrl`, `accountUrl`, `appsUrl`), the approvals feed of axHub
decision #85 (`fetchHubFeed`: the browser's own hub session, credentials included, redirects refused, reply capped at
256 KB; `interpretFeed` → ok / signed-out / not-admin / unreachable, only items whose link points at the hub, links rebuilt
from the id) and `seenPlan` (ring once per new approval). `libs/hub/index.ts` adds `HubWatcher` (polls while visible, on
focus, one check at a time). Mirrored by the Kotlin `lib-hub` (`HubRules`); both replay `spec/fixtures/hub-approvals.json`.
Self-test: `npx -y tsx framework/spec/check-hub.mts`. The console's approvals banner plugin runs on it. The hub protocol
contract (AXPP) is a named placeholder (`HUB_PLACEHOLDERS`), parked for Fable.
