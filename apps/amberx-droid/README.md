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
```

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
