# AmberX

An **empty shell for building and testing plugins** on the AmberX AXF framework (web app in a Capacitor shell, Oct 26
2026): banner, toolbar, nav menu, application menu, a basic context menu, the settings interface and the look (theme,
layout, style assets), voice commands, the **Approvals** page with its alerts and the whole **Monitor** plugin
(background approvals watch, alerts, auto-approval, wake phrase). Nothing else: every other page comes from a plugin.

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
| `src/plugins/plugin-store` | Plugins from axHub: browse the catalog, install / update / remove through axHub's confirm page |
| `src/native.ts` | The one seam to the native side (`AmberxNative`), with a browser fallback |
| `android/app/src/main/java/ai/amberx/droid` | `WatchService` (foreground service), `AmberxNativePlugin`, `HubWebActivity`, `HubRules` |
| `src/views/Approvals.tsx`, `src/hub` | Approvals, the only page of its own (home; through lib-hub) |
| `src/plugins/<folder>` | Your plugins: drop one in and it joins the nav, menus, search and Settings → Plugins |
| `src/axf/` | Baked framework: don't edit, re-bake |

Security: every native hub call goes only to `https://axhub.amberxai.com` with the phone's hub session, never follows a
redirect and is capped at 256 KB; approvals are decided on the hub's own page; the lock screen shows only "Approval
waiting"; the hub session and watch settings are excluded from backups.

## Building and testing a plugin

1. Copy `src/plugins/_template` to `src/plugins/<folder>` (folders starting with `_` never load) and set `id`, `name`,
   `version` in its `plugin.json` (`amberx-plugin@1`).
2. Export `library` (an `AxfWebLibrary`) from `web/index.tsx`. Whatever it declares shows up by itself: `views` +
   `nav` (side navigation), `appMenu` / `contextMenu` items, `settings` groups (a sub-tab of **Settings → Plugins**),
   `banners`, actions, search entries. Voice phrases: `registerVoiceCommands` from `plugins/voice/web/index.tsx`.
3. `npm run dev` and try it; `npx -y tsx test.mjs` checks the shell still holds.
4. Ship it through the plugin catalog (see `src/plugins/README.md`); the hosted app picks it up on its 5-minute update.
