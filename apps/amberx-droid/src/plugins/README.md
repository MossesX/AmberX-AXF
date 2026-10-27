# AmberX plugins

Plugins for AmberX (`apps/amberx-droid`), plugin-catalog kind **`amberx`** (`amberx-plugin@1`). Web only: a plugin
is `plugin.json` + `web/index.tsx` exporting `library` (an `AxfWebLibrary`), plus an optional `README.md`. The same
bundle runs in the browser and inside the Android shell (`android/`), so a plugin that needs a native piece reaches it
through `src/native.ts` (Capacitor bridge, with a browser fallback), never through Capacitor directly.

- **Bundled:** `voice` (voice control), `monitor` (background monitoring) and `plugin-store` (Plugins from axHub) ship with the app.
- **Install one from the phone:** AmberX → **Get plugins** lists the catalog; Install opens axHub's confirm page, and axHub
  commits the folder (axHub decision 101). No Dev Console needed.
- **Install one:** `node framework/cli/plugin-catalog.mjs app-install amberx <folder> --publish` /
  `app-uninstall amberx <folder> --publish` (commits just that folder to GitHub).
- **Publish one:** `AXF_TOKEN=… node framework/cli/plugin-catalog.mjs publish apps/amberx-droid/src/plugins/<folder> --kind amberx --console https://console.amberxai.com`
- **New one:** copy `_template` (folders starting with `_` never load).

AmberX is an empty shell for building and testing plugins (Oct 26 2026): its only page of its own is Approvals, so
everything a plugin declares in its library (views + nav, app-menu and context-menu items, settings groups under
Settings → Plugins, banners, actions) is all there is besides it. Voice commands: a plugin adds phrases with
`registerVoiceCommands(module, commands)` from `voice/web/index.tsx`; each maps trigger phrases to an action id the
runtime already knows.
