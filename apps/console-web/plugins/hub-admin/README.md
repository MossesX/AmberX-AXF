# Hub (hub-admin)

Every axHub web page as a console screen (hub-console@1, `framework/spec/HUB-CONSOLE.md`). One **Hub** view on the
console nav with a tab-group row (`hub.tabs`) drawn from the route table `framework/schemas/hub-console.json`. The console
is the only hub UI (Nov 18 2026); the AXHub web app is retired and its address redirects here.

| Screen | Tab | What it does | Reads | Actions (who) |
| --- | --- | --- | --- | --- |
| Hub | `overview` | session, waiting count, how decisions reach the hub, one tap to every screen | `hub_status` | check, sign-in (command); sign-out (person) |
| Approvals | `approvals` | held and pending calls, live countdown, title-first reason, the exact call in a fold | `hub_approvals_list`, `hub_approval_get` | approve, deny, shelve, postpone, ignore, revoke, reopen, auto-start (person); auto-stop, check, notify-phone (command) |
| Approval log | `log` (`approval-log`) | every request and how it ended; filters service, tool, who, outcome, decided via, pass | `hub_approval_log` | download (command) |
| Passes and veto | `passes` | active passes with countdown, requests waiting for Grant, the grant form, the go pass, veto countdown and No wait read-only | `hub_passes_list` | grant, go (person); revoke (confirm); request, extend, go-end (command) |
| Users | `users` | accounts, roles, permissions, state | `hub_users_list`, `hub_users_get` | password (person); invite, role, permissions, disable, signout, delete (confirm); profile, enable (command) |
| Account | `account` | profile, password, signed-in browsers, linked phone, notification preferences | `hub_account_get` | password, signout (person); signout-others (confirm); profile, phone, notifications (command) |
| Apps and connectors | `connectors` | every service with status, policies, key health; row = service detail (tools, schemas, policy editor, recent calls) | `hub_services_list`, `hub_service_get` | policy, add, reconnect, remove (confirm; add / reconnect / remove answer `hub_missing` today) |
| Handoff | `handoff` | the Claude account handoff kits; run detail with prompt, files, log | `hub_handoff_list`, `hub_handoff_get` | send, accept (command; accept is `hub_missing`); clear (confirm, `hub_missing`) |
| Auth admin | `auth` | sign-in rules; OAuth clients and API tokens (`hub_missing` on today's hub) | `hub_auth_get` | token-create (person); token-revoke, client-add, client-remove (confirm) |
| Apps | `apps` | the hub's app catalog with downloads | `hub_apps_list` | download (command) |

## How each one is reached

- **Deep link:** `view:hub/tab:hub.tabs=<screen>`; a row `…/grid:hub.<screen>/row:<id>`; a button `…/button:<action>`.
  Actions `hub.open[:<screen>[:<row>]]`, `hub.focus:<screen>/<row>`, `hub.<screen>` (and `hub.approvalLog` for the alias);
  URL `https://console.amberxai.com/?axf-open=hub.open:approvals:<id>`.
- **REST:** `GET /api/plugins/hub-admin/<screen>[/<row>]`, `POST …/<screen>[/<row>]/<action>` (`DELETE …/<screen>/<row>`
  for a row-removing action). Answers are JSON with `ok`; a read that could not be served says why: `signed_out`,
  `forbidden`, `old_hub`, `hub_unavailable` (after three tries), `hub_missing` (with the proposed hub route), `relay_off`.
- **MCP:** the tools above (plugin-commands@1 derives them from `plugin.json` → `commands.items`); a confirm action
  answers `confirmation_required` with a token on the first call and runs on the second with `confirm`.
- **CLI:** `axf hub <screen> [<row>] [<action>] [--k v] [--json]` (`hub.mjs`); person actions have no command line.
- **Voice:** AmberX runs console actions by id: `hub.<screen>`, `hub.<screen>.<action>` for commands.
- **Person actions** (approve, deny, shelve, postpone, ignore, revoke, reopen, auto-start, grant, go, set a password,
  sign out, create a token) are Brett's own tap through the approvals-banner relay (`axf.hub-relay@1`), registered
  `personOnly`: out of every catalog, refused to remote callers, skipped in the command registry.

Settings → Plugins → Hub: the registered `axf.hub.*` settings (veto countdown writes the policy table through a confirm;
No wait read-only; connectors shown; approvals source filter; hub notices on the phone), the values the screens remember
(grid columns, log filters, grant defaults, poll) with Reset, the lifecycle panel. `install.mjs` runs the one-shot
settings migration (`framework/cli/hub-settings-migrate.mjs`).

Page toolbars: three looks per screen (`assets/toolbar/hub-<screen>[-dense|-grouped].json`, written by `toolbars.mjs`
from the table; `--check` in the self-test), picked per screen through the toolbar's own context menu (Change…).

Phone Connect: a watcher sends every new waiting call once to the phone (`axf.phone@1.notify`) with the console deep
link; `notify.json` declares `hub.notice` and `hub.pass-request` for the Notifications panel; `axf.hub.phone.notices` turns
it off. Systems check: `hub-console-read` (can the console read the hub) and `hub-connectors` (dead connector keys).

Files: `web/` (index, approvals, log, passes, users, account, connectors, handoff, auth, overview, settings, data,
controls, store, actions), `server/__init__.py` (the proxy, actions, confirm tokens, watcher, health), `hub.mjs` (CLI),
`toolbars.mjs`, `hooks.mjs`, `install.mjs` / `uninstall.mjs`, `help.json`, `notify.json`, `test.py` (server), `test.mts`
(pure parts). Checks: `node framework/spec/check-hub-console.mjs`, `node framework/cli/check-hub-parity.mjs`.
