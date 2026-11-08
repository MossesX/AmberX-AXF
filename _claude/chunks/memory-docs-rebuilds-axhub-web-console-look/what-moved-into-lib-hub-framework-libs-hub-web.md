<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/axhub-web-console-look.md tokens=300 -->
## What moved into lib-hub (`framework/libs/hub`, web)

- `apps.ts` (new): the `/apps.json` rules (`interpretApps`, `appDownloadUrl` = the only way a download link is made,
  caps 100 apps / 5 builds / 512 KB, `APPS_FEED_PATH`, `appsFeedUrl`, `fetchHubApps` with the feed's transport rules) and
  the display words (`formatSize`, `formatWhen`, `shortSha`, `expiry`, `statusNote`). From the app's `src/hub/feed.ts` +
  `client.ts` (deleted), unchanged in behaviour.
- `react.tsx` (new): `useHubApprovals(hub)` (one shared watcher per hub, ref-counted), `useHubApps(hub)`,
  `useHubBannerCount(hub, {counter, banner})`, `HubApprovalList`, `HubStatusNote`, `HUB_CHECK_EVENT` / `checkHubNow`.
- `menu.ts` (new): `installHubMenu(rt, {hub})`: live lists `hub.approvals`, `hub.apps` and actions `hub.open:<page>`,
  `hub.review:<id>`, `hub.download:<project>:<file>`; every link rebuilt from the hub address and checked with `isHub`.
- Fixture: `spec/fixtures/hub-approvals.json` gained an **`apps`** section (path, url, limits, 23 reply cases); nothing
  else in it moved. `spec/check-hub.mts` replays it and drives `fetchHubApps` (credentials, no redirects, size cap, bad
  address) and the display words.
