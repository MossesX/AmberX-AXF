# Gizmo opens by voice/link (AmberX web app + Android app); the new look sticks after reload

Build `gizmo-opens-by-voice-link-amberx-web-app-android` · Phase 1 · Opus · branch `claude/gizmo-opens-by-voice-link-amberx-web-app-android`

Brett (Nov 10 2026, 21:37): "That Gizmo didn't open. There's an AmberX web app tied to the app, so why won't it work? Now it's loading the old banner again, the old look."

## Why it didn't open
- Gizmo had no address. The AmberX web app (https://amberx.amberxai.com, the same site the Android app loads) read no URL route, so no link could land on Gizmo.
- `amberx.open_url` always opened the URL in Chrome, never in AmberX.
- The console had no `gizmo` screen, so `console_open "gizmo"` / `console_show "gizmo"` returned not_found.
- A tapped console alert reached AmberX's `open` event, which only opened axHub pages.

## Why the old look came back
`HubAppLookStore` dropped a failed save without saying anything: the skin showed on screen, the hub kept its older document, and the next reload drew that older document. Now a save is kept on the device until the hub has it, retried with a back-off (1 s, 5 s, 20 s), re-sent on the next load (unless the hub holds a newer look from another device), and a refused save shows a toast plus a terminal warning with the reason.

## What changed
| Where | What |
|---|---|
| `apps/amberx-droid/src/deeplink.ts` (new) | `/gizmo`, `/gizmo/new`, `/gizmo/talk`, `/?open=gizmo…` run `companion.open/new/talk`; it waits for the action to register, then sets the URL back to `/` |
| `apps/amberx-droid/src/App.tsx`, `native.ts`, monitor plugin | Runs the page's own link, plus `link` and `open` events from Android; the monitor skips AmberX links |
| Android `AndroidManifest.xml`, `MainActivity`, `AmberxNativePlugin`, `OpenUrlRules`, `AxppLink` | Verified app link for `https://amberx.amberxai.com/gizmo*`; `OpenUrlRules.inApp`; `amberx.open_url` opens AmberX's own links in the app; JUnit cases |
| `apps/amberx-droid/server/main.py`, `deploy/install.sh` | `/.well-known/assetlinks.json` from `AMBERX_APP_CERT_SHA256`; installer `APP_CERT_SHA256=…` (remembered); a public Traefik router for that file only, outside the sign-in wall |
| console-commands plugin | Gizmo screen (`view:gizmo`), actions `gizmo.open[:mode]` + `gizmo.phone[:mode]`, `GET|POST /api/console/gizmo`, CLI `axf console gizmo [chat|new|talk] [--link]`, a "Tap to open Gizmo" alert when the phone can't be asked |
| systems-check plugin | Item `amberx-app-links`: amber until the app-link file names the APK's signing key, with the fix steps |
| `framework/react/hubAppLook.ts`, `core/runtime.ts`, `core/engines/skin.ts` (+ baked copies in console-web, amberx-droid) | Look save persistence (above); `AppLookStore.saveError?()`; PORTING.md gap recorded |

## How each is reached (API)
- **Deep link:** https://amberx.amberxai.com/gizmo (`/new`, `/talk`)
- **Console screen:** `console_open gizmo` / `console_show gizmo` (MCP), `POST /api/console/open {"screen":"gizmo"}`
- **Open on the phone:** `POST /api/console/gizmo {"mode":"chat|new|talk"}` (MCP through plugin-commands auto, from the route), `console_action gizmo.phone:talk`, `axf console gizmo talk`
- **Links:** `GET /api/console/gizmo`, `axf console gizmo --link`
- **Voice (AmberX):** "open gizmo", "talk to gizmo" (existing phrases)
- **State:** the look's unsaved state is `AppLookStore.saveError()` (runtime toast + terminal)

## Tests
- `npx tsx apps/amberx-droid/test.mjs`: 2342/2342 (deep link rules, the late-action runner, manifest/open_url/link wiring)
- `python apps/amberx-droid/server/test_server.py`: 177 passed (assetlinks + `/gizmo` SPA)
- `python apps/console-web/plugins/console-commands/server/test_console_commands.py`: 89 checks (links, phone open, bad mode, forbidden, fallback alert)
- `node apps/console-web/plugins/console-commands/test.mjs`: 7 · `python apps/console-web/plugins/systems-check/test.py`: 233
- `npx tsx framework/spec/check-skin.mts`: 216 (new "look survives reload" block)
- `tsc --noEmit` console-web and amberx-droid: clean · check-theme, check-controls, check-toolbars, check-chrome-assets, check-plugin-pages, plugin-lifecycle console-commands: pass
- `OpenUrlRulesTest` (JUnit): written, runs in CI (no Java on the VPS)

## Left / needs Brett
- **App link verification needs the APK's signing key fingerprint** (systems check item `amberx-app-links` has the steps). Until it's set, `/gizmo` links open the AmberX web app, and `amberx.open_url` still opens Gizmo in the app directly.
- New APK from CI for the Android parts (app link, open_url in the app).
- UI Review screenshots weren't taken: Playwright isn't installed on this runner (`axf shot` fails). The Gizmo console screen still needs desktop and phone shots.
