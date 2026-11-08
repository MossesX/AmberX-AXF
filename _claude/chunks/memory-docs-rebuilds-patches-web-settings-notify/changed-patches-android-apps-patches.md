<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-web-settings-notify.md lines=64-79 tokens=349 -->
## Changed — Patches Android (`apps/patches`)

- `WebAppHolder("patches", takes = [settings, notifications])`; tabs get `onMessage` (lib-hub bridge).
- View `settings` = **CombinedSettings** (same 4 tabs; app tabs are web views `settings:<app>` in page mode).
- App menu shown (layout `showMenubar`, manifest no longer hides `app-menu`; asset `app-menu/patches`, static on
  Android). Context items via `addContextItems` (default + nav-item with `patches.settings:{payload}`).
- **Patches serves the phone's notifications**: `NotificationsModule` + `WorkModule(PatchesWatch)`: one lib-work job
  = hub approvals feed (alert per new approval, cleared when decided) + the console's `/api/alerts` (errors and
  warnings, once per change, cleared when resolved/read; console cookies, redirects never followed, 512 KB cap) +
  what an app in a tab sends (`notify`). Setting **Serve all notifications** (default on); POST_NOTIFICATIONS asked
  once; a tapped notification opens the right tab. Channels: watching, approvals, console alerts, from the apps.
- **AXHub app stays quiet while Patches is installed** (`ApprovalWatch.patchesInstalled`, manifest `<queries>`);
  it still tracks seen approvals so nothing old pops up later.
- lib-hub: `WebAppHolder(takes)`, `WebAppView(onMessage)` (`AxfEmbedHost` bridge, believed only while the page is on
  the tab's origins), `WebAppHolder.send(tab, json)`.
