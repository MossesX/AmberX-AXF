# Harvest group hub-notify — lib-hub (first slice) + lib-notifications (Oct 20 2026, Opus)

Brett's decision: lib-hub gets an Opus first slice with only what axHub serves today; the hub protocol contract (AXPP)
stays parked for Fable (named placeholders only). Background polling is NOT a framework piece yet (Fable group `x.work`).

## What moved

| From | To |
|---|---|
| `apps/axhub-android/.../hub/HubClient.kt` → `HubAddress` (normalize, isHub, approval/login/apps URLs) | `framework/android/lib-hub/.../HubRules.kt` (pure) + web `framework/libs/hub/hub.ts` |
| `.../hub/HubClient.kt` → `HubClient.feed()`, `signOut()`, `parse()`, `readLimited()` | `lib-hub/.../HubClient.kt` (`HubClient(session)`, `HubSession`, `WebViewHubSession`) + `HubRules.interpretFeed` |
| `.../hub/HubState.kt` → `WatchPrefs`, `HubState` | `lib-hub/.../HubState.kt` (`WatchPrefs(context, file)`, seen ids now ordered + `track()`; AXHub passes its old file name `axhub_watch`, so saved values carry over) |
| `.../views/HubWebView.kt` → web view + `downloadFromHub` + `signOutOfHub` | `lib-hub/.../LockedWebView.kt` (`LockedWebView(origin, url, …, javaScript = false, onDownload)`, `hubApkDownloads`, `HubDownloads`) + `WebViewHubSession.clear` |
| `.../watch/Alerts.kt` → channels, canPost, canFullScreen, ongoing, approval alert, signed-out notice, cancel by tag | `framework/android/lib-notifications` (`AxfNotifications`, `ChannelSpec`, `OngoingSpec`, `AlertSpec`, `NoticeSpec`, `NotificationsModule`); `Alerts.kt` stays as a thin AXHub layer (its channel ids, wording, intents) |
| `apps/console-web/plugins/approvals-banner` → hub URL check, feed fetch, status mapping, "only hub links" filter | `framework/libs/hub` (`normalizeHub`, `fetchHubFeed`, `interpretFeed`, `approvalUrl`) |
| test `HubAddressTest.kt` (3 tests) | `lib-hub/src/test/.../HubConformanceTest.kt` (fixture replay) + `apps/axhub-android/.../watch/AlertsTest.kt` |

Deleted: `apps/axhub-android/app/src/main/kotlin/ai/amberx/axf/axhubandroid/hub/HubClient.kt`, `hub/HubState.kt`,
`views/HubWebView.kt`, `app/src/test/.../hub/HubAddressTest.kt`.

## Who uses it now
- **AXHub app**: `HubModule(hub, credentials = cookieCredentials{…})`, `NotificationsModule(this, Alerts.channelSpecs)`, all screens on `HubRules`/`HubClient.Default`/`HubState`/`LockedWebView`/`hubApkDownloads`; manifest lists `ai.amberx.axf.hub` + `ai.amberx.axf.notifications`.
- **Console approvals-banner plugin** (0.2.1): browser reads the feed through `@console/axf/libs/hub/hub` (credentials included, redirects refused). Its banner, review dialog, auto-open and settings are unchanged. The console server still never sees the session. plugin-lifecycle@1 check: clean.

## Contracts / fixtures
- New fixture `framework/spec/fixtures/hub-approvals.json` (generated in `gen-fixtures.mts` from `libs/hub/hub.ts`): constants, address normalize/origin/isHub (incl. Unicode, user-info, backslash, port, IPv6 cases), URLs, approval ids, login return paths, APK names, CSRF, 26 feed replies (status mapping, foreign/missing links dropped, bad ids, duplicates, caps, counts), seen-id plans. Replayed by `framework/spec/check-hub.mts` (web, 183 checks) and `HubConformanceTest` (Kotlin).
- Placeholders: `axf.hub.axpp` (AXPP, Fable), `axf.hub.push`, `axf.hub.admin-api`; `axf.notifications.alerts`, `.push`, `.schedule`.
- alert@1 hook: `AlertNotifications.plan(change)` / `AxfNotifications.deliverAlert(...)` (delivery channel `device`; repeats never ring). Nothing subscribes `AlertCenter` yet.

## Guards kept or tightened
Kept: https-only plain-host hub address; links only to the exact hub origin; approval links only for real ids; feed with
the session cookie only, no redirects, 256 KB cap; never approves via API; web view no JS / file / content / mixed content /
third-party cookies, every navigation + redirect checked, nothing loads off-origin; APK downloads only `/apps/download/<project>/<file>.apk` on the hub, cookie sent only to the hub; sign-out = CSRF form post with hub Origin; lock screen only "Approval waiting" (VISIBILITY_PRIVATE + public version, channel PRIVATE); never over the lock screen; FLAG_SECURE (MainActivity untouched); session never backed up (backup rules untouched); WebView debugging off.

Where the two copies disagreed (stricter kept):
- **Foreign links**: Android ignored the item's `url` and rebuilt it; web dropped items whose `url` wasn't the hub. Now both: an item needs a `url` on the hub **and** the link used is rebuilt from the id.
- **Address parsing**: Android used `java.net.URL`, web `new URL()`; both now use one hand parser (ASCII hosts only, no `@`, `\` ends the authority, ports 1–65535). Uppercase approval ids are refused on both (was: web accepted any string id).
- **Signed-out mapping**: web only mapped 401/403; Android also read `signedIn:false` / `admin:false` in a 200 body. Both do both now.
- Field caps (tool 120, summary 600, times 64) and max 50 items now apply on web too.
- New: `loginUrl` refuses return paths with `//` or `..`.

## Tests before → after
- AXHub unit tests: 3 (`HubAddressTest`) → 2 (`AlertsTest`) + lib-hub `HubConformanceTest` 7 (5 fixture tests replayed locally with kotlinc 2.0.21: OK) + lib-notifications `AlertNotificationsTest` 4 (3 replayed locally: OK). Android CI compiles the rest (written without a compiler).
- Web: lib-hub 0 → 183 checks (`check-hub.mts`, now in CI). Unchanged and passing: check-mcp 210, check-widgets 93, alerts, plugin inventory, project fixtures 16, server tests (alerts, app_catalog 15, app_ci 32, plugin_catalog 19, wall_users 56), every plugin test.py.
- validate --framework, tracker --check, plugins --check, project validate --all, check-theme (206 → 208 files), axhub-android + console-web validate, console tsc + vite build: all clean. Fixtures: only `hub-approvals.json` added.

## What AXHub's ApprovalWatchService still owns (for the Fable `x.work` group)
1. Foreground service lifecycle: `startForeground(ID_WATCH, …, FOREGROUND_SERVICE_TYPE_SPECIAL_USE)` with the manifest `specialUse` subtype property; quiet stop when Android refuses a background start.
2. The polling loop: `HubClient.Default.feed(prefs.base)` → `HubState.update` → `prefs.track(ids)` → clear gone alerts / alert fresh ones → update the ongoing notification; interval `prefs.intervalSec` (15–300 s), **5 min back-off when signed out / not admin**, a one-time "sign in" notice per signed-out spell.
3. Start/stop/check-now intents (`ACTION_STOP`, `ACTION_CHECK_NOW`), `START_STICKY`, stop when watching is off, `HubState.setRunning`.
4. `WatchBootReceiver`: restart after `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED` when watching is on.
A framework work piece would take: a periodic job spec (interval, back-off rule from the job result), a foreground-service host with a notification provider (lib-notifications `ongoing`), boot/update restart, and the job body = steps in (2), which only call lib-hub + lib-notifications.

## Merge with `fable/theme-from-hub` (commit 4eb8b48), which also creates `framework/android/lib-hub`
Same module (`lib-hub`), package `ai.amberx.axf.hub`, library id `ai.amberx.axf.hub`. Already shaped to merge as one:
- `HubCredentials.kt`, `HubSignIn.kt`, `src/main/AndroidManifest.xml`: **copied byte-identical** from 4eb8b48 (both sides identical → no conflict).
- `build.gradle.kts`: this branch's file is a superset of theirs (adds `androidx.activity.compose`); **take this branch's**, keep their description words about appearance if wanted.
- `HubModule.kt`: **conflict, merge by hand**. Same constructor `(hub = HubOrigin.DEFAULT, appId = null, credentials)` (this branch defaults `credentials` to `cookieCredentials { hub }`). Merged `register` = theirs (create `HubAppearanceSource`, register it as `axf.appearance.source`, `runtime.attachAppearanceSource`) **plus** this branch's (`client = HubClient(HubSession.of(credentials))`, register `HubClient` as `axf.hub`); `provides` = both capabilities; keep `placeholders()` and `CAPABILITY`. Register `HubModule::class` once (theirs passes capability "axf.hub", this branch registers `HubClient` under it: keep `HubClient` on `axf.hub`, `HubModule` without a capability).
- Their-only files kept as is: `HubAppearanceSource.kt`, `HubAppearanceSourceTest.kt`. This-branch-only: `HubRules.kt`, `HubClient.kt`, `HubState.kt`, `LockedWebView.kt`, `HubConformanceTest.kt`, `library.json`.
- Two address helpers stay side by side: their `HubOrigin.normalize` (allows `http://localhost|127.0.0.1|10.0.2.2` for dev, used by the appearance source + sign-in view) and `HubRules.normalize` (https only, used for approvals/sessions). Approvals, downloads and the locked web view must keep `HubRules`. Their internal `isHub` in HubSignIn.kt is looser (java.net.URL); the approvals path never uses it.
- `HubSignInView` (theirs) vs `LockedWebView` (this): keep both. `HubSignInView` is sign-in only (fixed page, `done()` callback); `LockedWebView` is the general origin-locked view used for approvals, the hub list and the Apps tab.
- `settings.gradle.kts`: both add `include(":lib-hub")`; keep one line (this branch also adds `:lib-notifications`).
- `android.yml`: one task line `… :lib-mcp:testDebugUnitTest :lib-hub:testDebugUnitTest :lib-notifications:testDebugUnitTest`; keep both `check-appearance.mts` and `check-hub.mts` lines.
- `libraries.json` / `library.json`: one entry `ai.amberx.axf.hub` (this branch's `library.json`, theirs had none); after merge add `"f.appearance.source"` to its `features` and mention the appearance source in the description, then `node framework/cli/tracker.mjs`.
- AXHub app: their `App.kt` adds `HubModule(hub = WatchPrefs(this).base, credentials = cookieCredentials { WatchPrefs(this).base })` with import `ai.amberx.axf.axhubandroid.hub.WatchPrefs` (deleted here): take this branch's line (same call via `hubPrefs(this)`). `build.gradle.kts`: one `lib-hub` line. Their `MainActivity.hubSignIn` uses the deleted `HubWebView`/`HubAddress`: rewrite as
  `val base = hubPrefs(this).base; LockedWebView(base, HubRules.loginUrl(base), onPage = { url -> if (!url.contains("/auth/login") && !url.contains("/auth/first")) done() })` (imports `ai.amberx.axf.hub.LockedWebView`, `ai.amberx.axf.hub.HubRules`, `…watch.hubPrefs`).

## Left for later
- AXPP (Fable), hub push, admin API; Python port of lib-hub (no Python user yet).
- `x.work`: lift ApprovalWatchService (above).
- Wire alert@1 → device notifications (an Android alerts library subscribing `AlertCenter.onChange` → `AxfNotifications.deliverAlert`).
- Web `HubWatcher` is unused by the console plugin (it keeps its own store for banner + dialog); new web apps can use it.
- Build Pilot: no adoption needed now (it has no hub feed code). If it wants the approvals banner: copy `framework/libs/hub` into its baked framework, `fetchHubFeed(hub)` from the browser (its origin must be allowed by `AXHUB_APPROVALS_ORIGINS` or sit under the hub cookie domain on https), render `feed.pending` and open `p.url`.
