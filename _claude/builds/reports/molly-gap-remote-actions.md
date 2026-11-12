# molly-gap-remote-actions (Current profile; s1 Fable, s2-s3 Opus; headless worktree sessions)

Brett (Nov 10 2026): "Standalone apps keep working until Molly covers them; list gaps as pending builds."
Found by molly-sign-in-once s1. Branch `claude/molly-gap-remote-actions`, PR #502.

## The gap

The console-commands relay reached the console frame inside Molly, never Molly itself, so Molly-level actions
(`molly.*`, `navigation.*`, `xlayout.*`, the sign-in actions) could only be run inside Molly (menus, toolbar, search).

## What shipped (s1, commit caecb667f)

- **Molly plugin `remote-commands`** (`apps/molly/plugins/remote-commands`): Molly's own client on the relay, app
  `molly`. Announces Molly's catalog (views, apps' pages, settings tabs, dialogs, every registered action), keeps the
  stream, runs each `console-command@1` through Molly's runtime and acks. Token: localStorage `molly:console-token`
  (same key as the credential seam); `molly.auth.console.base` honoured. Stops on 401/403.
- **Engine** `framework/core/engines/console-commands.mjs`: `to` takes an app name (`molly`, `console`); `recent` with a
  path picks the client in front whose catalog has it; a list without a client spans every client, tagged `app`. Baked
  copies refreshed in molly, console-web, amberx-droid, axhub-web, walkthrough-studio.
- **Plugin commands:** `apps/molly/plugins` is a registry home (app `molly`); tools / routes / CLI cover Molly plugins.
- **MCP / CLI:** `console_list` takes `to`; `axf console … --to molly|console`.
- Kotlin twin deferred in `framework/spec/PORTING.md`.

## s2: standalone apps keep working; gaps listed

Nothing in the standalone Console, axHub web, AmberX or Walkthrough Studio changed behaviour: they keep their own
clients; `to` defaults to `recent` as before. Open gaps stay as their own pending builds:
`molly-gap-console-token-handoff` (Molly gets the console token without a paste) and molly-sign-in-once s2 (its
screen can now be called done once this lands).

## How each thing is reached (Everything comes with an API)

| What | REST | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|
| Open Settings → Plugins → Remote commands | `POST /api/console/settings {"tab":"plugins/remote-commands","to":"molly"}` | `console_settings(…, to="molly")` | `axf console settings plugins/remote-commands --to molly` | same MCP tool |
| Read state | `GET /api/control/molly:remote-commands/status` | `console_action("remote-commands.status")`, `console_clients` | `axf plugin remote-commands status` | same |
| On/off, toasts, reconnect, forget token (confirm) | `POST /api/console/action {"id":"remote-commands.listen on"}` (forget-token: 409 + confirm token) | `console_action(...)`, `molly_remote_commands_*` | `axf console action remote-commands.…` | same |
| Any Molly action / screen | `POST /api/console/action` / `open` with `to: molly` | `console_action("molly.reload")`, `console_open(…, to="molly")` | `axf console list actions --to molly` | same |

The console token itself is never read or set remotely, on purpose (a browser credential).

## Checks (s3, Nov 12)

All pass: `console-commands/test.mjs` (8), `plugin-commands/test.mjs` (41), `check-console-commands.mts` (75),
`plugin-commands.mjs check` (66/66), `AXF_PLUGINS_DIR=apps/molly/plugins plugin-lifecycle.mjs check remote-commands`
(clean; without the env var it checks the console's folder and wrongly flags the Molly README line), `check-theme`,
`check-controls`, `check-toolbars`, `check-chrome-assets`, Molly `tsc --noEmit`, `py_compile mcp_server.py`.
Not run: the console server's Python tests (no FastAPI here).

## Left

- **UI Review not submitted.** Molly from a local vite server stops at "Waiting for axHub" (the hub answers 401 /
  blocks the localhost origin), so headless shots show only that card. Shots need a session that can sign in to axHub
  (or the deployed Molly): Settings → Plugins → Remote commands, desktop + phone, then
  `review.mjs submit --kind settings --app molly --screen remote-commands --group "molly-gap-remote-actions - …" --pr 502`.
- Baked `control-rules.mjs` in molly / axhub-web / walkthrough-studio were already behind the framework; left alone.
