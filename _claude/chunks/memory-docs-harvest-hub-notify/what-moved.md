<!-- memory-chunk@1 source=_claude/memory/docs/harvest/hub-notify.md tokens=442 -->
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
