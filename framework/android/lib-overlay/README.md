# lib-overlay — the overlay@1 asset on Android

A floating pill drawn **over other apps**: a foreground service (special use) owns a `TYPE_APPLICATION_OVERLAY` window
with a draggable, resizable Compose pill built from the app's theme tokens. Any app or module puts status chips on it,
answers its quick action, logs lines into its tappable panel, fills its mini screen with its own composable and shows a
card under it. While the pill is hidden a small untouchable strip in the corner flashes the last lines.

Everything that is a rule lives in the kernel's `OverlayEngine` (= `framework/core/engines/overlay.ts`, fixture
`spec/fixtures/overlay.json`): what the asset means, size and position clamps, log trimming, strip expiry, chip state,
the user's settings over the asset. This module only draws and hosts.

Generalised from the detection overlay of Brett's hands-free YouTube controller (its custom-drawn `OverlayView`, the
`MiniLogView` strip, the `TunePopup` card and the overlay half of its detection service). Nothing app-specific came
along: the camera, triggers and accessibility context stay in that app and talk to this one through `OverlayHost`.

## Install

```kotlin
// App.modules()
OverlayModule(this, OverlayNotification(R.drawable.ic_notification, "Overlay", "Showing the overlay", MainActivity::class.java))
```

The app's manifest repeats the service with the Play-required special-use property (what the overlay is for):

```xml
<service android:name="ai.amberx.axf.overlay.OverlayService" android:exported="false" android:foregroundServiceType="specialUse">
    <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Floating status pill the user turns on" />
</service>
```

The user grants **Display over other apps** once: `overlay.canDraw()` says whether, `overlay.requestPermission()` (or the
`overlay.permission` action / Settings → Overlay → Allow drawing over other apps) opens the system page. Depends on
`lib-notifications` for the quiet ongoing notification.

## API (`OverlayHost`, registered as `axf.overlay`)

```kotlin
val overlay = kernel.services.get<OverlayHost>()!!          // or AxfOverlay.current

overlay.show() / hide() / toggle()                         // starts / stops the service
overlay.setChips(listOf(Chip("armed", "Armed", "Idle"), Chip("mic", "Mic", "Mic off", tone = "info", icon = "mic")))
overlay.setChip("armed", true)                              // state per chip; the asset's own chips are the default set
overlay.setTitle("Detector")
overlay.onQuickAction { spec -> … }                         // else the asset's `pill.quickAction` spec goes to the action bus

overlay.log.add("swipe up", confidence = 0.91, tag = "fired", ref = "trig.swipe-up")
overlay.log.onTap { line -> overlay.setCard { dismiss -> TuneCard(line.ref, dismiss) } }   // tap-to-tune

overlay.setMiniContent { CameraPreview() }                  // any composable fills the mini screen
overlay.openMini(true) / toggleMini() / openLog(false)
overlay.setCard(null)                                       // close the card
overlay.resetGeometry()                                     // forget the dragged position + resized mini screen
overlay.state                                               // StateFlow<OverlayState>: visible, shown, miniOpen, chips, position, miniSize …
```

Actions: `overlay.show`, `overlay.hide`, `overlay.toggle`, `overlay.mini`, `overlay.log`, `overlay.reset`,
`overlay.permission`, `overlay.stop`. Settings group **Overlay** (`axf.overlay.*`): opacity, position lock, log panel,
strip while hidden, mini screen open at start, mini screen size (`w,h` dp), reset, permission. Settings keys are the
engine's (`OverlayEngine.Settings`), so the web port reads the same ones. Position (px) and mini size (dp) persist in
the KV store under `axf.overlay.position` / `axf.overlay.size`.

## Files

| File | What |
| --- | --- |
| `OverlayHost.kt` | `OverlayHost` (the API), `Chip`, `OverlayLog`, `OverlayState` |
| `OverlayController.kt` | the state machine behind the host: geometry clamps, persistence, chips, quick action, log, config refresh — pure, unit-tested |
| `OverlayModule.kt` | `OverlayModule` (registration, settings group, actions, placeholders), `AxfOverlay` (Android glue: service start/stop, permission, effective config), `OverlayNotification` |
| `OverlayService.kt` | the foreground service: pill window while visible, strip window while hidden, re-reads config on swaps / settings changes |
| `OverlayWindows.kt` | a ComposeView in a window-manager window with its own lifecycle + saved-state owner; layout params |
| `OverlayRoot.kt` | theme + locals for an overlay window (no window-width feedback into the app's layout) |
| `OverlayPill.kt` | the pill: drag header (grip, title, chips, quick action, mini toggle, hide), mini screen + resize corner, log panel, card slot |
| `OverlayStrip.kt` | the collapsed strip: engine-timed line expiry |

Tests: `OverlayControllerTest` (JVM; `:lib-overlay:testDebugUnitTest` in CI) + the kernel's `OverlayConformanceTest`
(same fixture as the web `check-overlay.mts`).

## Known gaps / placeholders

- Written without an Android compiler (the pure parts were compiled and run with a local kotlinc); CI is what builds the
  Compose + service half.
- The strip only shows while the service runs (it keeps running after `hide()` while `strip.show` is on; `overlay.stop`
  ends it). Starting the service for the strip alone, without ever showing the pill, is the app's call (`show()` then `hide()`).
- Settings defaults mirror the active asset at registration; a later asset swap changes the engine's values but not the
  defaults the settings UI shows until a value is set.
- Placeholders: `axf.overlay.web` (the web port's corner pill), `axf.overlay.bubbles` (Bubbles as the host),
  `axf.overlay.pip` (picture-in-picture as the mini-screen host).
