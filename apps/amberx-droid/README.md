# AmberX

Voice-controlled, plugin-driven Android app on the AmberX AXF framework (web app in a Capacitor shell). It takes over
the AXHub app: approvals with alerts, the hub, app downloads, auto-approval, plus voice control and background
monitoring with the screen off.

```bash
npm install
npm run dev                      # the web app in a browser (Web Speech fallback)
npm run build && npx cap sync android
cd android && ./gradlew :app:assembleDebug   # needs JDK 21 + Android SDK 36 (CI job "amberx" builds it)
npx -y tsx test.mjs              # hub, voice and monitoring rules
sudo bash deploy/install.sh      # on the VPS: serve it at https://amberx.amberxai.com (--remove rolls back)
```

**Hosted, not bundled (Oct 26 2026):** the shell loads `https://amberx.amberxai.com` (`capacitor.config.json`
`server.url`; `allowNavigation` = that host + the hub only; `public/offline.html` when unreachable). The site is under the
hub's cookie domain, behind axHub's sign-in wall, so you sign in once inside the app and the same session reaches the
hub's feeds and data server (the bundled `https://localhost` copy sent sign-in to an outside browser, so it never
signed in). Hub calls from the hosted page go straight from the WebView; only a bundled copy routes them natively
(`src/hosted.ts`). The site updates itself from `main` every 5 minutes, so web changes reach the phone without a new APK.

| Path | What |
| --- | --- |
| `src/plugins/voice` | Voice control: commands (`web/core.ts`), mic, spoken replies, wake event |
| `src/plugins/monitor` | Background monitoring: watch settings, auto-approval, status |
| `src/native.ts` | The one seam to the native side (`AmberxNative`), with a browser fallback |
| `android/app/src/main/java/ai/amberx/droid` | `WatchService` (foreground service), `AmberxNativePlugin`, `HubWebActivity`, `HubRules` |
| `src/views`, `src/hub` | Approvals, Hub, Apps, Manage (from the axHub web app, through lib-hub) |
| `src/axf/` | Baked framework: don't edit, re-bake |

Security: every native hub call goes only to `https://axhub.amberxai.com` with the phone's hub session, never follows a
redirect and is capped at 256 KB; approvals are decided on the hub's own page; the lock screen shows only "Approval
waiting"; the hub session and watch settings are excluded from backups.
