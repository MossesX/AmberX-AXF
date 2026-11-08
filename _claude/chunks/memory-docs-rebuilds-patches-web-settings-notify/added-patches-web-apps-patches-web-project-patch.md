<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-web-settings-notify.md tokens=368 -->
## Added — Patches web (`apps/patches-web`, project `patches-web`)

- `axf init … --template web-fastapi-wall --developer` (React/TS + FastAPI behind axHub's wall; look from axHub).
  Assets: `layout/patches-tabs` (menu bar on), `nav-menu/patches-tabs`, `banner/patches`, **`app-menu/patches`**
  (Patches: Settings, *Settings for* ▸ Patches/Console/Pilot/axHub, reload / open the tab in front, About; Apps; View).
- The three apps in frames marked `?axf-embed=patches&axf-embed-take=settings`, kept alive (`AppShell keep`); the
  console's banner strip (`?axf-strip=banners`) in `app.frame.top`, sized by `patches-strip@1` messages.
- **Combined Settings** (view `settings`): tabs **Patches · Console · Pilot · axHub**. Patches = lib-settings' screen
  (+ group Patches: app addresses, console banners). Each app = its own settings page in page mode
  (`axf-embed-page=settings`; axHub = `/auth/account`), kept alive; a sub-tab an app asks for is sent as `open-tab`.
- Hooks: `app.settings` (app menu, banner settings button, Ctrl+,), `patches.settings:<app>[:<tab>]`, context menu
  (default + canvas: *Settings*, *Reload*; a tab: *Settings for this app*, *Settings*).
- Deploy: `sudo bash apps/patches-web/deploy/install.sh` → `https://patches.amberxai.com` (clones AmberX-AXF, builds
  the app folder; no repo of its own — `patches-web` is only reserved). Needs a DNS record for `patches` and, on
  axHub, `AXHUB_EMBED_FRAME_ANCESTORS=https://patches.amberxai.com`.
