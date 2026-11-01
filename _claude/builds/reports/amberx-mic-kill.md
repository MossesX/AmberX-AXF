# AmberX: Mic off kill switch + letting go of the mic for other apps

Nov 1 2026 · Opus · branch `claude/amberx-mic-kill` · change log `chg-20261101-2b7c5db07b`

Brett: "AmberX needs a button, a quick switch. It disables all the listening, turns the green dot off my phone, turns
off the microphone, completely disables all listening." Also a live bug from that morning: AmberX held the mic, so a
Claude voice call couldn't use it, and he had to close AmberX.

## Verdict: a NEW APK is required

Most of this is native (the watch service, the wake listener, the Speak recognizer, the recorder's mic track, the
quick-settings tile, the notification button). The web auto-update only brings the page side: the Home switch, the
banner chip, the toolbar button and the page's own mic gate. **With the old APK the page switch can't stop the native
listener.** Install the new AmberX APK from CI (`amberx-debug.apk`, Android workflow on this branch / main after
landing → hub Apps). Until it's installed, the reliable way to free the mic is still: AmberX → Voice → Hands-free off.

## What causes the mic grab

What the code shows, read file by file (no phone or emulator here, so this wasn't reproduced on a device):

1. **The holder is the hands-free watch service, and it never let go for anyone.** Hands-free is on by default. In the
   default wake mode, `WakeListener` keeps a `VOICE_RECOGNITION` `AudioRecord` open nonstop inside a foreground service
   of type `microphone`, with the detection overlay on top. Before this build nothing in AmberX checked whether a call
   or another app wanted the mic. On Android 10+ another app *should* still get audio, but Samsung's One UI and apps
   that check the audio mode or active recordings before they start a voice session (the Claude app's voice mode runs
   as a VoIP call, `MODE_IN_COMMUNICATION`) can refuse or get silence. That matches "had to close AmberX".
2. **Why it got worse this morning: `02e951c2` (amberx-listeners, 07:10 UTC, web, live through the 5-minute
   auto-update).** The voice plugin now re-sends the hands-free config to the native side on every sound-owner change
   and every device-switch change (`onSound(() => { last = ''; sync(); })`, `onDeviceChange(…)`), not only when the
   config itself changed. Each send runs `voiceSet` → `WatchService.setVoice` → `refresh` → `onStartCommand`, which
   cancels a running one-shot and starts the listen loop again. So any time the mic was freed, it could get grabbed
   right back. That's the only mic-related change in the auto-updated web code since the evening before.
3. **`3ba092d2` (recorder-mic) is not the cause unless he turned it on.** Its mic track opens only while the Audio
   Output Recorder records *and* "Record my mic too" is on (off by default). It also needs the new APK, so it can't
   arrive through the web auto-update. `e46b8079` (rec-control) only adds the AXPP link to the watch service. It opens
   no mic.

The fix covers all three: Mic off stops everything, hands-free now lets go by itself, and re-sending the config can't
re-grab the mic while Mic off is on or while another app has it.

## What was built

### Mic off (one tap, everywhere)
- **One native gate, `MicGuard.java`.** Every mic user calls `MicGuard.mayOpen()` before opening the mic:
  - the wake listener (Vosk `AudioRecord`)
  - the classic recognizer loop
  - the one utterance after a trigger
  - Speak (`AmberxNativePlugin.listen`)
  - the recorder's mic track (`OutputRecordService.openMic`)

  `MicGuard.set(off)` applies it at once:
  - the watch service stops listening, drops the `microphone` foreground type, or stops altogether when it was only
    there for hands-free
  - the detection overlay goes
  - a running Speak recognizer is cancelled
  - the recorder's mic track is let go (playback recording carries on)

  The green dot goes off. The setting is kept in prefs, so it survives restarts and reboots (`BootReceiver` →
  `refresh` honours it).
- **One page gate, `src/micguard.ts`.** It wraps `navigator.mediaDevices.getUserMedia` and
  `SpeechRecognition`/`webkitSpeechRecognition` before any module captures them (first import in `main.tsx` and
  `native.ts`). While off:
  - an audio request is refused with `NotAllowedError`
  - a recognizer ends at once with `not-allowed`
  - every open audio track and recognizer is stopped the moment it's switched on

  This also covers console plugins loaded into AmberX (Agent voice, dictation and so on). It publishes
  `globalThis.__axfMicOff` (`mic-off@1`), and the mic lease `withMic` refuses while off. It's kept on this device only,
  never synced, so another device can't turn a phone's mic back on.
- **Where the switch is:**
  - **Home:** the "Microphone" card under the page head, with a big full-width button ("Mic off" / "Turn the mic back
    on"), a state chip (Listening / Mic on / Paused for another app / Mic off) and a plain line saying what's true right
    now.
  - **Banner:** the `status/amberx-mic` widget, "Listening" / "Mic off". Tap it to flip. It's attached at run time, so
    it shows on every banner asset.
  - **Toolbar:** the `mic-off` item in `toolbar/amberx-droid` (pause icon; the framework has no mic-off icon).
  - **Application menu:** AmberX → Mic off (stop all listening), with a check mark (`counter:amberx.mic.off`).
  - **Settings:** Sound and microphone, at the top of the tab.
  - **Android, with the app closed:**
    - the quick-settings tile **"AmberX mic"** (`MicTile`: lit = may listen, dark = Mic off)
    - a **Mic off / Mic on** button on AmberX's ongoing notification
- **Saying "mic off" isn't one of the ways** (it needs the mic). These are all buttons.
- **Help:** help@1 entries `action:amberx.mic.toggle` and `amberx-mic-switch`.

### Letting go for other apps (the hog fix)
- `WatchService` watches for other recordings (`registerAudioRecordingCallback`) and for audio mode changes
  (`addOnModeChangedListener`, Android 12+). It also checks every 2 s as a fallback.
- It lets go when any of these is true:
  - a call, ringing or VoIP session is on (`MODE_IN_CALL`, `IN_COMMUNICATION`, `RINGTONE`, …)
  - Android silences one of AmberX's own recordings
  - another app records from the real mic

  Letting go means: wake listener stopped, recognizer destroyed, one-shot cancelled.
- It comes back by itself once the mic has stayed free for 3 s.
- AmberX's own recordings register their session ids with `MicGuard`, so they never count as "another app". Google's
  recognizer (another process) is allowed for while AmberX runs it.
- These never count as another app: playback capture and screen-recorder audio (`REMOTE_SUBMIX`), and the system
  hotword detector (`HOTWORD`). Without that, AmberX could stay paused forever on some phones.
- The Speak button is explicit, so it doesn't yield. Mic off still stops it.
- The page shows the pause ("Paused for another app"), and the status carries `yielded`.
- Mic turned back on from the tile while AmberX is in the background: Android 14 may refuse a background `microphone`
  foreground start. The service then runs without the mic until AmberX is opened, and `MainActivity.onResume` picks it
  up again.

### Pure rules + tests
- `MicRules.java` holds the pure rules (yield reason, call modes, mic sources, resume delay, labels). JUnit
  `MicRulesTest` has 7 tests. They are compiled and run by the Android CI, since there's no JDK on the VPS.
- `test.mjs` has a new **Mic off** block. Its page-gate tests use a fake page (`getUserMedia` + `SpeechRecognition`):
  - streams and recognizers are released when it's switched off
  - new requests are refused
  - video is left alone
  - it's kept after a reload
  - constructors are wrapped once
  - the chip and detail wording are checked

  It also checks the wiring on both sides (every native mic user asks `MicGuard`; tile, notification, manifest, banner,
  toolbar, menu, help, tokens-only CSS). Two older checks were updated for the new guard conditions.

## Checks

| Check | Result |
|---|---|
| `npx -y tsx apps/amberx-droid/test.mjs` | **2192/2192** (new Mic off block: 41 checks) |
| `tsc --noEmit` (amberx-droid) | clean |
| `vite build` (amberx-droid) | built |
| `check-theme.mjs` | theme-conformant |
| `check-controls.mjs` | every button a framework control |
| `axf.mjs validate apps/amberx-droid` | 396 assets valid |
| `help-coverage.mjs` | exit 0 |
| `plugin-lifecycle.mjs check` (CI loop) | 24 failures, **none from this build**: stale paths inside untracked synced `sessions/archive/*.json` and the apps' synced `_claude/shared` copies on this VPS checkout. No plugin folder was touched |
| JUnit `MicRulesTest` + Java compile | **CI** (Android workflow) |
| Browser run (Playwright, phone 412×915 + desktop) | Home switch flips, banner reads "Mic off", state kept after reload, no page errors |

## Screenshots

In `_claude/builds/reports/amberx-mic-kill/`: `home-mic-on-{phone,desktop}.png` and `home-mic-off-{phone,desktop}.png`.
The test browser had no hub session, so they show "Failed to fetch" for approvals. They were **not** sent to UI Review
from here: the shot CLI needs `AXF_CONSOLE_URL` + `AXF_TOKEN`, and this headless VPS session has neither. To send them
(group name per the headless rule):
`node framework/cli/shot.mjs _claude/builds/reports/amberx-mic-kill/home-mic-*-*.png --name "AmberX Home: Microphone switch" --app amberx-droid --screen home --group "amberx-mic-kill - Nov 1 11:46 AM" --console`.
There are no native shots (tile, notification) because there's no emulator here.

## Known gaps
- Not tested on a phone. The yield logic depends on what Samsung's One UI reports in `getActiveRecordingConfigurations`
  and the audio mode during a Claude voice call. The 2 s tick plus the mode check covers the VoIP case either way.
- The Audio Output Recorder's **playback** capture and Audio Extract's screen recorder record what the phone *plays*,
  not the mic. Mic off leaves them running, because stopping a session recording on a mic switch would lose it. If
  Android shows its indicator for playback capture, stop the recording from its own notification.
- With the old APK installed, only the page side works (see Verdict).
