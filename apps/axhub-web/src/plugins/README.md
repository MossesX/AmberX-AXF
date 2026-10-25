# axHub web plugins

Plugins for the axHub web app (`apps/axhub-web`), plugin-catalog kind **`axhub`** (`axhub-plugin@1`). Web only: a plugin
carries `plugin.json`, `README.md` and `web/**`; `web/index.tsx` exports `library`, an `AxfWebLibrary` (views, dialogs,
menus, settings, banners — the same shape as every AXF web library). Import the framework from `../../../axf/react`.

They run only in the browser. The hub's server never loads them (axHub decision #93: the server core never depends on AXF).

- **Install / uninstall:** Patches → Plugins per app (axHub column), or on the Dev Console host
  `node framework/cli/plugin-catalog.mjs app-install axhub <folder> --publish` / `app-uninstall axhub <folder> --publish`
  (console routes `GET /api/app-plugins/axhub`, `POST /api/app-plugins/axhub/install|uninstall {folder, confirm}`). The
  folder is committed to GitHub and axhub-web's 5-minute update rebuilds with it.
- **Publish one:** `AXF_TOKEN=… node framework/cli/plugin-catalog.mjs publish apps/axhub-web/src/plugins/<folder> --kind axhub --console https://console.amberxai.com`
- A plugin that doesn't type-check stops the rebuild (the running app stays as it was): keep `npm run build` green.
- `_template/` is the starting point; folders starting with `_` never load.
