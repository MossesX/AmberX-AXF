# Molly control (Molly plugin)

Brett, Nov 8 2026: "Everything comes with an API." Every Molly screen, tab, setting and action is reachable without the
UI, through the four surfaces the console already has, with no second server and no second sign-in.

- **How:** molly-shell@1 (`framework/core/engines/molly-shell.ts`). Molly hands every console frame inside it a
  catalog of its own screens (apps, copies such as `console#2`, the apps' pages), settings tabs, dialogs and actions as
  console-command@1 items under `host:` ids (embed@1 `host-catalog`). The console announces them with its own catalog,
  so the console server resolves "Console 2" or "molly.new-tab" like any console item; the console carries the command
  back up as embed@1 `host-run` and Molly runs it (navigate, open the settings tab or dialog, dispatch the action).
- **Reach it:**
  - REST: `POST /api/console/open {"screen": "Console 2"}`, `POST /api/console/action {"action": "molly.new-tab:console"}`,
    `GET /api/console/list?kind=screens&q=molly`, `GET /api/console/where`.
  - MCP: `console_open`, `console_settings`, `console_dialog`, `console_action`, `console_list`, `console_where`.
  - CLI: `axf console open "console 2"`, `axf console action molly.new-tab console`, `axf console list screens molly`,
    `axf console where`.
  - Voice (AmberX → console commands): "Amber, open Console 2 in Molly", "Amber, run new tab console".
- **Readable state:** `axf console where` answers with the console's screen and Molly's (`· molly: Console 2`);
  `axf console list screens molly` lists what Molly can show, open copies included. The `molly.state` action says the
  same in Molly (molly-shell@1 `shellState`).
- **Settings:** Settings → Plugins → Molly control: on / off, a note per command, the consoles joined, what reached
  Molly last.

```bash
node apps/molly/plugins/control/install.mjs
node apps/molly/plugins/control/uninstall.mjs --all
AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check control
```
