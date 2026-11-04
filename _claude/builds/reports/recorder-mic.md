# recorder-mic: opt-in mic so both sides of a session get recorded

Nov 1 2026 · headless · Opus, one session · AmberX-AXF (`claude/recorder-mic` → `main`, pushed directly per Brett's
brief) + axHub (`claude/recorder-mic`, opened as a PR by the push banner) · Codebase changes entry
`chg-20261101-ebfbf401f1`. Builds on `amberx-listeners` (already on main at the start: no wait needed) and `rec-control`.

## Install the new APK

**Install the new AmberX APK.** The `android.yml` run on `main` for this push builds it: job **AmberX**
(`:app:testDebugUnitTest :app:assembleDebug`, which also runs the new JUnit tests), artifact **`amberx-debug.apk`**.
It also goes into the app catalog bundle, so on the phone: **axHub → Apps → AmberX → install**, or download the
artifact from that Actions run. Until it's installed, the phone records playback only and ignores `mic`.

**The approval title needs the axHub branch merged.** `MossesX/axHub` branch `claude/recorder-mic` (commit `1e5553f`).
The push banner opens its PR and auto-merges it once CI is green; Coolify then redeploys the hub. Until then the old
hub refuses `mic` (its input schema doesn't know it) and the approval reads `Start recording: <session>`.

## What Brett gets

- **Settings → Plugins → Audio Output Recorder → Microphone → "Record my mic too"**, **off by default**. The description
  starts with "Your mic picks up anyone in the room." Turning it on asks Android for the microphone **only then** (via
  `micPermission`). Refused = the switch goes back off with a toast.
- **`amberx.recorder_start {session_name, group?, note?, mic?}`** is still a **straight approval** (confirm,
  `explicitApproval`; no veto countdown, no auto-approve window). The approval title is now
  `Start recording: <session> (Playback + MIC)` or `(Playback only)`:
  - `mic: true` / `mic: false` on the call wins;
  - `mic` left out = the phone's setting **as the phone last reported it** (`micDefault` in its recorder state).
- **Two tracks per chunk.** Stereo AAC, **left = Brett's mic, right = phone playback**, on one timeline. Same 30-minute
  chunks, same `<session> - <YYYY-MM-DD HH-mm> - partN` names, same upload to the session's group on axHub. Each index
  gains `mic: true`, `tracks: {left: "mic", right: "playback"}`, `micBusy: [{fromMs, toMs, reason}]` and `micBusyMs`.
  The Chat viewer's two-voice export and future transcription can split speakers by channel.
- **Notification:** "Recording: <session> (playback + mic)" with "… · playback + mic" and two buttons, **Stop** and
  **Stop mic**. Stop mic lets go of the mic at once; the playback recording carries on, and the mic side is marked
  `stopped` from then on.
- **Audio out page:** a chip ("playback + mic", "mic busy: playback only · mic silenced by Android", or "Playback
  only · mic off"), and the info note follows the **live** recording, not just the setting.

## How it works

| Piece | Where |
|---|---|
| Mixer, rings, busy spans, notification line (pure Java, JUnit) | `android/…/TwoTrack.java` (new) |
| Mic capture, two-track pump, busy detection, Stop mic, release | `OutputRecordService.java` |
| Setting `mic` (default false), session mic, `micWanted` | `OutputRecordQueue.java` |
| `mic` + `mic_source` from the hub, `micFor` | `RecorderControl.java` |
| Status: `mic`, `micBusy`, `micDefault`; consent notification says "(Playback + MIC)" | `AxppLink.java` |
| Index fields `mic`, `tracks`, `micBusy`, `micBusyMs` | `OutputRecordUploader.java` |
| `micPermission` (Capacitor permission alias `microphone`), settings `mic` | `OutputRecorderPlugin.java` |
| FGS type `mediaProjection\|microphone` | `AndroidManifest.xml` |
| Setting, chip, live note, `micToggled`, state for `micBusy`/`micBack`, index parsing | output-recorder `web/*` (0.1.0 → 0.2.0) |
| `mic` arg, title `{mic?Playback + MIC\|Playback only}`, `approvalArguments`, `micDefault()` | axHub `device-relay` |
| `{arg?yes\|no}` in approval titles; connectors may give `approvalArguments()` (device/builtin only, title only) | axHub `core/hub.ts`, `connector.ts` |

- **Capture.** The mic is a second `AudioRecord` with the `VOICE_RECOGNITION` source. I picked that source on purpose:
  `VOICE_COMMUNICATION` and `CAMCORDER` are privacy-sensitive in Android's concurrent-capture rules, so they would
  take the mic away from a call or from the Claude app's voice mode. Echo canceller and noise suppressor are switched
  on when the phone has them.
  - Each source has its own reader thread and a 2 s ring buffer.
  - The pump takes 2048-frame blocks on the mic's clock (the mic always delivers, silence included), or playback's
    clock when the mic is out. It pads the other side with silence, and drops backlog so the two sides never drift
    more than 0.5 s apart.
- **Mic busy, three ways:**
  - Android won't open it: `STATE_INITIALIZED` / `RECORDSTATE_RECORDING` fails, or the microphone foreground-service
    type is refused.
  - Android silences it: `getActiveRecordingConfiguration().isClientSilenced()`, checked every second.
  - It stops delivering: `read < 0`.

  In each case the left side is silence, the span is marked (spans carry across chunk boundaries, at most 100 per
  chunk), the event `micBusy` goes to the page, and a "Mic busy: recording playback only" notification is posted. A
  silenced mic that comes back clears it (`micBack`). Nothing here fails the recording.
- **Never more mic than approved.** When the hub fills `mic` from the phone's last reported setting, it sends
  `mic_source: "default"`. The phone then turns the mic on only if its setting is **still** on, so a setting switched
  off after the approval still means no mic. `false` always stays off.
- **Single owner (respecting amberx-listeners).** This is a plain capture: no recognizer, no new event listener or
  subscriber. Events still go to the one `OutputRecordService.listener` set by the plugin, and the static test checks
  that. Hands-free (Vosk / Google) isn't touched or paused. The mic is released in `release()` on every stop path
  (switch, tile, notification, `recorder_stop`, Android ending capture, errors).

## Honest limits

- **Android's mic is shared badly.** When the Claude app's voice mode (or a call) holds the mic, Android usually gives
  AmberX silence (silenced capture) or refuses it outright. So during a Claude voice call the mic track will mostly be
  a marked gap, and the right side (playback) still gets Claude.
  - Brett's own voice gets recorded when nothing else holds the mic: typed Claude sessions, or Claude voice through a
    route that doesn't hold the mic exclusively.
  - Which one wins depends on the phone and the Android version. Android's rule is that the app on top or doing
    privacy-sensitive capture keeps the mic.
- **Calls still can't be captured** on the playback side (Android never offers call audio).
- **Background start.** Android 11+ lets a service use the mic only if it was started from the app in the
  foreground. A start from axHub that Android allows only through the notification tap still qualifies, because the
  consent activity starts the service. If Android refuses the microphone type anyway, the recording starts
  playback-only and is marked `unavailable` rather than failing.
- **The permission prompt is rarely seen.** AmberX already holds RECORD_AUDIO (playback capture and hands-free use
  it), so turning the switch on usually needs no prompt. It's only asked when missing.
- **The hub's default can be stale.** `micDefault` is refreshed whenever the phone says hello or answers a call. The
  `mic_source` rule makes staleness fail safe (never records the mic when the approval said "Playback only").
- **No native notification screenshot.** There's no emulator or phone on this box. The notification text and buttons
  are covered by the static test (`"Recording: playback + mic"`, `"Stop mic"`, `"Mic busy: recording playback only"`).
- **The Java was compile-checked here, not built.** `javac` against android-35 + Capacitor jars showed no errors in
  any changed file, and the JUnit tests ran locally. The full `assembleDebug` runs in CI.

## Tests

| Suite | Before → after |
|---|---|
| output-recorder `test.mts` | 18 → **24**: toggle default off (only explicit `true`), mic busy/back/stop state, two-track index + spans, permission only on toggle-on (refused = off), mic only in the service, VOICE_RECOGNITION only, two tracks + busy markers + Stop mic + release on stop, **no second listener**. |
| AmberX JUnit (local, JDK 21 `--release 17`) | **TwoTrackTest 9 new** (L = mic / R = playback, stereo→mono, mic busy = silent left, shared clock + padding, ≤ 0.5 s drift, ring overflow, busy spans across chunks, span cap, notification line) + `RecorderControlTest` mic (start's choice / setting / `mic_source` default / non-boolean refused). With HubRulesTest: 22 pass. |
| axHub `pnpm test` (Node 22, docker) | **517/517** (3 new in `amberx.test.ts`: title follows `mic` and the phone default; args and `mic_source` reach the phone; non-boolean `mic` refused). Existing title tests updated to the new title. |
| AmberX `test.mjs` | 2101/2101 before the merge; **2143/2143** after merging main. |
| `apps/amberx-droid` `npm run build` (tsc + vite) | green |
| android.yml local test block | Node checks: all pass. Python checks pass with `python3`, except `test_wall_users.py` ("the page itself": needs the built console page, which CI builds first; console server untouched). `axhub-web refresh-check` needs `apps/axhub-web` node_modules (untouched). |
| theme / controls / plugin pages / lifecycle (clean export) / validate / manifests / build steps | all green |

## Screenshots

UI Review → Screenshots, group **Recorder mic - Nov 1** (on the console):

- `s-20261101-191a594a`: setting, phone
- `s-20261101-b7ea5ea9`: setting, desktop
- `s-20261101-4b54ae41`: Audio out recording playback + mic, phone
- `s-20261101-26ce8791`: mic busy, phone

How they were taken: against a stand-in axHub (the hub's real look and settings files) and a stand-in native bridge
reporting a live recording.

## Notes

- Pushed straight to `main` per this brief, which overrides the shared "every change through a PR" rule. axHub went
  through a branch and PR instead.
- No orchestrator card or build-profile question: this was a headless session, and Brett asked for the build directly.
