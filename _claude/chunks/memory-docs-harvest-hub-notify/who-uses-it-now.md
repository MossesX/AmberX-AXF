<!-- memory-chunk@1 source=_claude/memory/docs/harvest/hub-notify.md lines=21-24 tokens=149 -->
## Who uses it now
- **AXHub app**: `HubModule(hub, credentials = cookieCredentials{…})`, `NotificationsModule(this, Alerts.channelSpecs)`, all screens on `HubRules`/`HubClient.Default`/`HubState`/`LockedWebView`/`hubApkDownloads`; manifest lists `ai.amberx.axf.hub` + `ai.amberx.axf.notifications`.
- **Console approvals-banner plugin** (0.2.1): browser reads the feed through `@console/axf/libs/hub/hub` (credentials included, redirects refused). Its banner, review dialog, auto-open and settings are unchanged. The console server still never sees the session. plugin-lifecycle@1 check: clean.
