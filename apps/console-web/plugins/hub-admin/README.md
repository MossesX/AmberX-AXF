# Hub (hub-admin)

Every axHub web page as a console screen (hub-console@1, `framework/spec/HUB-CONSOLE.md`). One **Hub** view on the
console nav with a tab-group row (`hub.tabs`) drawn from the route table `framework/schemas/hub-console.json`:
Hub, Approvals, Approval log, Passes and veto, Users, Account, Apps and connectors, Handoff, Auth admin, Apps.

- Deep link: `view:hub/tab:hub.tabs=<screen>` (rows `…/grid:hub.<screen>/row:<id>`, buttons `…/button:<action>`).
- Reads: `GET /api/plugins/hub-admin/<screen>[/<row>]`, MCP `hub_<screen>_…`, CLI `axf hub <screen>`, voice `hub.<screen>`.
- Actions: `person` ones (approve, deny, shelve, grant a pass, go pass, set a password, sign out, create a token) are
  Brett's own tap through the approvals-banner relay and are `personOnly`; `confirm` ones take a confirm token;
  `command` ones run plainly. The console token never decides.
- Settings → Plugins → Hub: every former axHub web setting (`axf.hub.*`), migrated once by
  `framework/cli/hub-settings-migrate.mjs`.

Files: `web/index.tsx` (the view and tab row), `server/__init__.py` (the proxy and action routes), `hooks.mjs`,
`install.mjs` / `uninstall.mjs` (plugin-lifecycle@1; data in `.axf-console/plugins/hub-admin`), `help.json`.
