<!-- memory-chunk@1 source=_claude/memory/docs/banner-status-bell.md tokens=259 -->
## alerts-bell

- The alerts bell **left the toolbar** (`console-search` toolbar 1.1.0: the `alerts` item is gone; Brett: banner only).
- Now two framework widgets on the banner's right after the clock: `action-button/alerts-bell` (bell icon, action
  `alerts.open`) and `counter/alerts-bell` (counter `alerts.unread`, danger tone, hidden at zero, `99+`, tap opens alerts).
- Settings → Plugins → Alerts bell: show/hide + side (right/left), status line, Open alerts, Alert settings.
- The alerts library (`framework/libs/alerts`: Alerts view, Settings → Alerts, transport, the counter) is unchanged;
  nothing else referenced the toolbar item (search, theme-swap script, tests checked).
- Web-only, no server part, no data.

Both: `install.mjs` / `uninstall.mjs` / `hooks.mjs` (plugin-lifecycle@1), banner items attached with origin = the
plugin id (the console's disable path calls `rt.detachAll(<plugin id>)`), pure logic in `web/core.ts` (tested against
the framework runtime by each plugin's `widget-check.mjs`), theme tokens only.
