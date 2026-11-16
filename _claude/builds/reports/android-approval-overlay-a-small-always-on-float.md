# Android approval overlay (`android-approval-overlay-a-small-always-on-float`)

Brett, Nov 13 2026 (verbatim): "Build me a overlay that expands with the approval every time one's sent. A little overlay, like a little toolbar, but it expands when I need an approval."

Note (same day): it follows the skin (light/dark) and is fully configurable (look, size, position, what it shows, when it expands) from the console and the phone, with full API and voice.

## What was built

**Phone (AmberX, Java):**
- `ApprovalOverlay.java`: a floating toolbar drawn over other apps ("Display over other apps", the same permission as the detection overlay). The toolbar shows a dot (red while a held call counts down), the next countdown or how many wait, a fold button and Open. When an approval or held command arrives that it has not shown yet, it opens into the full card: kind ("HELD COMMAND" / "APPROVAL", "1 of 3" with a next button), what (the command), why (the call's `reason.description`), a live countdown, then Approve / Deny, plus Shelve for held calls. When nothing is left it shrinks back to the toolbar, after `shrinkAfterSec`. Tap the label to open or fold the card; drag it up or down and the height is saved.
- Buttons use the phone's hub session. Held calls go through `VetoAlerts.act` (`approve-now` / `deny` / `shelve`), the same path as the notification buttons, so its notice and alarm stop too. Approvals go through `HubRules.decide`.
- `ApprovalOverlayRules.java` holds the pure rules (settings + clamps, list order, toolbar label, countdown line, when the card opens) and has unit tests in `ApprovalOverlayRulesTest.java`.
- `WatchService` gives it every approvals read, and it starts and stops with the service. The settings are stored in the watch prefs (`approvalOverlay`). Its colours come from the theme tokens AmberX already sends with the voice config, so it follows the active skin and light/dark.
- Native plugin: `approvalOverlaySet`, `approvalOverlayState`, `approvalOverlayCommand` (expand / collapse / approve / deny / shelve / approve-now / decline), and the `approvalOverlay` event.
- `HubRules.Veto` gains `why` (`reason.description`).

**Settings, API, voice (approvals-banner plugin, v0.7.0):**
- Settings → Plugins → Approvals banner → **Approval overlay (phone)**: Overlay on/off, Opens for (every approval / only held commands / never), Toolbar shows (next countdown / how many wait), Size (small / medium / large), Side (right / left), Height (% from top), Show when nothing waits, Opacity when nothing waits, Shrink back after (s). Keys: `approvals-banner.overlay.*`. These are ordinary runtime settings, so they follow the level toolbar.
- `web/overlay.ts`: the pure config (the same clamps as Java) and `parseOverlayChange` for spoken or typed names. The plugin pushes the config to the phone through the veto host (`VetoHost.overlay`, new optional `overlayCommand` / `overlayState`). Both lib-hub copies were changed the same way.
- Action `approvals.overlay:<what>:<value>` (for example `approvals.overlay:size:large`, `approvals.overlay:position:left`, `approvals.overlay:off`) and `approvals.overlay:expand|collapse`.

## How each piece is reached (API rule)
- **Deep link:** `console_open` / `console_show` Settings → Plugins → Approvals banner (settings tab `approvals-banner`).
- **REST / MCP / CLI:** the generic settings API (`console.settings`, `settings.set:approvals-banner.overlay.<key>:<value>`, control@1). The console action `approvals.overlay:…` is available through console actions (REST, MCP `console actions`, CLI).
- **Voice (AmberX):** the same `approvals.overlay` action ("overlay size large", "overlay off", "overlay expand").
- **State:** the settings can be read through the settings API. The live state (shown, expanded, what waits) is read on the phone through `approvalOverlayState`.
- **Deciding** from the overlay is Brett's tap only. The command path (`approvalOverlayCommand` approve/deny) exists only on the phone's native bridge. No console session can call it, which matches the `personOnly` rule on the banner's own deciding actions.

## Checks
- `ApprovalOverlayRulesTest` + `HubRulesTest`: 17 tests green. Run with javac/JUnit in an `eclipse-temurin:21-jdk` container, because the VPS has no Android SDK.
- `approvals-banner/test.mts`: 23 checks green (3 new for the overlay).
- `tsc --noEmit` passes for console-web and amberx-droid. `check-theme` and `check-controls` are green.
- `plugin-lifecycle check approvals-banner`: its only finding is the gitignored local `.axf-focus.json` (the live-preview focus file), not something in the repo.
- **Not compiled here:** `ApprovalOverlay.java`, `WatchService.java` and `AmberxNativePlugin.java` need the Android SDK. CI's `:app:testDebugUnitTest :app:assembleDebug` compiles them.

## Gaps / next
- The overlay reads approvals only while approvals watching is on (`WatchService` `on`), the same as the notices.
- Its colours update when AmberX sends the voice config (theme tokens). A skin change shows up the next time that config is sent.
- UI Review: there are no phone screenshots of the overlay yet. That needs the new APK on a device. The settings panel can be shot from the console after deploy.
- The repo rule says no new Android work. This build is Android by nature (Brett's request is a phone overlay), so it was built in AmberX's existing Java shell, next to the detection overlay. There is no Kotlin twin.
- A new AmberX APK is needed for the overlay to show.
