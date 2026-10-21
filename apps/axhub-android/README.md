# AXHub (Android)

Phone app for Brett's axHub, built on **AmberX AXF 0.2.0** (`android-compose` template). First job: put every approval request on the phone the moment the hub asks. Later: manage the whole hub from here.

## How it works

1. **Sign in once** inside the app (the hub's own sign-in page). The session stays in the app's web view store, never backed up.
2. **Watching** (on by default): a quiet ongoing notification; the app checks `GET /auth/admin/approvals.json` every 30 s (Settings → AXHub → Check every).
3. **New approval:** a high-priority alert, full screen like an alarm when Android allows it (Android 14+: allow "full-screen alerts" for AXHub; the app links to the setting). Tap it and that approval's page opens in the app; tap **Approve** on the hub's own page.
4. Each approval rings once. After a restart or update, watching resumes by itself.

## Security

- The web view only shows the hub's address (https, exact host); any other link opens in the phone's browser and redirects elsewhere are stopped. No JavaScript, file or content access, or mixed content.
- The app never approves through an API; approving happens on the hub's own page, so the hub's Origin + CSRF checks apply.
- Never shows over the lock screen; the lock screen only says "Approval waiting". Screens are kept out of screenshots and recents.
- Optional app lock (Settings → Unlock: fingerprint or PIN, via lib-lock's `LockGate` + `Gated` around every view). Picking PIN without a saved PIN, or fingerprint without a working sensor, is refused (lib-lock's mode guard). If the lock can't run, **Sign out and reset** drops the hub session before turning it off.
- Secure window (`android.secureWindow` in `axf.manifest.json`): FLAG_SECURE and WebView debugging off, applied by the framework.
- Hub address must be plain https with no path.

## Framework libraries it runs on

- **lib-hub** (framework/android/lib-hub, harvested from this app Oct 20 2026): hub address rules, the approvals feed + status mapping, sign-out on the hub, watch settings + seen ids (`WatchPrefs`, kept in this app's original `axhub_watch` preferences file), `HubState`, the origin-locked web view and the Apps tab's downloads.
- **lib-notifications** (framework/android/lib-notifications, harvested from this app): channels, permission checks, the ongoing "watching" notification, the private-lock-screen approval alert.
- **lib-lock**: the app lock.
- **lib-work** (framework/android/lib-work, harvested from this app's `ApprovalWatchService` + `WatchBootReceiver` Oct 21 2026): the foreground service, STOP / CHECK_NOW / INTERVAL commands, 5-minute back-off while signed out, the one-time sign-in notice, stop when watching is off and the boot/update restart. The app only registers `watch/ApprovalWatch.kt`: a job spec (data, the same one the framework fixture `spec/fixtures/work.json` replays) and a body that checks the feed once through lib-hub and alerts through lib-notifications.
- What stays in the app: `Alerts.kt` (its channel ids, wording, intents) and `ApprovalWatch.kt` (the job spec + one check).

## Planned (routes and placeholders already in place)

Services · Jobs · Audit log · Vault (names only) · Users · Projects · Devices, waiting on the hub's admin API (step 4), log viewer (step 7) and device agent (step 6). Placeholder capabilities: `axhub.admin-api`, `axhub.push` (hub-pushed alerts instead of checking), `axhub.agent`.

## Build

CI builds it (`axhub-debug.apk` artifact on the Android workflow). Locally: `gradle :app:testDebugUnitTest :app:assembleDebug` (JDK 17 + Android SDK 35).
