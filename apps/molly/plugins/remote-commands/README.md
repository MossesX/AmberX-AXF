# Remote commands (Molly plugin)

Build `molly-gap-remote-actions` (found by molly-sign-in-once s1): the console-commands relay reached the console frame
inside Molly, not Molly itself, so Molly-level actions (`molly.*`, `navigation.*`, `xlayout.*`, the sign-in actions)
could only be run inside Molly. This plugin gives Molly its own client on the same relay.

- **What it does:** Molly announces itself to the console server (`POST /api/console/hello`) as app `molly` with its own
  catalog: its views (the apps and, once xLayout has them, the apps' pages `<app>/<item>`), settings tabs and sub-tabs,
  dialogs and every registered action. It keeps the stream open, runs each `console-command@1` through Molly's runtime
  (`rt.search.focus`, `rt.openDialog`, `rt.dispatch`) and acks it. Same code path as the console's Console commands
  plugin; the engine is `framework/core/engines/console-commands.mjs`.
- **Delivery:** `to: molly` names Molly itself (`to: console` a Dev Console, inside Molly too). Without a `to`, the relay
  now sends a command to whichever open client has the thing named, in front / used last first, so `molly.reload`
  reaches Molly even when the console inside it was touched last. A list without a client spans every open client
  (items tagged `app`).
- **Four reaches, all the same:** REST `POST /api/console/action {"id": "molly.reload", "to": "molly"}`,
  `POST /api/console/open {"screen": "console/nav:builds", "to": "molly"}`, `GET /api/console/list?kind=actions&client=molly`;
  MCP `console_action("molly.reload")`, `console_open("…", to="molly")`, `console_list(kind="actions", to="molly")`,
  `console_where`/`console_clients`; CLI `axf console action molly.reload`, `axf console open account --to molly`,
  `axf console list actions --to molly`; AmberX voice calls the same MCP tools. Molly's plugin commands
  (`plugin.json` → `commands`) are in the plugin-commands registry as app `molly` and dispatch with `to: molly`.
- **Credentials:** the console's bearer token for Molly's origin, localStorage key `molly:console-token` (the same key the
  credential seam of molly-sign-in-once uses for the Console backend, so one sign-in serves both); the console API base
  override `molly.auth.console.base` is honoured. No token: the client waits and the settings tab says so. The token is
  never read or set remotely.
- **Settings:** Settings → Plugins → Remote commands: on / off, a toast per command, connection state, token, reconnect,
  forget token. Actions: `remote-commands.status`, `remote-commands.reconnect`, `remote-commands.listen on|off`,
  `remote-commands.toasts on|off`, `remote-commands.forget-token` (confirm).

```bash
node apps/molly/plugins/remote-commands/install.mjs
node apps/molly/plugins/remote-commands/uninstall.mjs --all
AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check remote-commands
```
