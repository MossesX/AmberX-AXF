# Plugins from axHub

Browse the plugin catalog on axHub and install, update or remove AmberX plugins from the phone, with no Dev Console
(axHub decision 101).

- **Get plugins** (nav, app menu, right-click, voice "get plugins") lists every `amberx` plugin in the catalog with its
  state here: Not installed, Update available, Installed.
- **Install / Update / Manage** opens axHub's own confirm page (`#/plugins/install/amberx/<folder>`). axHub checks the
  package and writes it into `apps/amberx-droid/src/plugins/<folder>` as one commit with the vault's GitHub token. It
  only takes that from you, signed in on the hub's page.
- AmberX's site rebuilds from main about every 5 minutes; then **Reload AmberX** loads the plugin.
- Voice: "get plugins", "check for plugin updates".

This plugin holds no token and never writes anywhere. It reads `GET <hub>/plugins.json?kind=amberx` with your hub
session (redirects refused, never cached). Rules and tests: `web/core.ts`, `apps/amberx-droid/test.mjs`.
