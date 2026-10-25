# AmberX plugins

Plugins for AmberX (`apps/amberx-droid`), plugin-catalog kind **`amberx`** (`amberx-plugin@1`). Web only: a plugin
is `plugin.json` + `web/index.tsx` exporting `library` (an `AxfWebLibrary`), plus an optional `README.md`. The same
bundle runs in the browser and inside the Android shell (`android/`), so a plugin that needs a native piece reaches it
through `src/native.ts` (Capacitor bridge, with a browser fallback), never through Capacitor directly.

- **Bundled:** `voice` (voice control) and `monitor` (background monitoring) ship with the app.
- **Install one:** `node framework/cli/plugin-catalog.mjs app-install amberx <folder> --publish` /
  `app-uninstall amberx <folder> --publish` (commits just that folder to GitHub).
- **Publish one:** `AXF_TOKEN=… node framework/cli/plugin-catalog.mjs publish apps/amberx-droid/src/plugins/<folder> --kind amberx --console https://console.amberxai.com`
- **New one:** copy `_template` (folders starting with `_` never load).

Voice commands: a plugin adds phrases with `voiceCommands` (see `voice/web/commands.ts`): each maps trigger phrases to an
action id the runtime already knows. Monitors: a plugin adds a check with `registerMonitor` (see `monitor/web/monitors.ts`).
