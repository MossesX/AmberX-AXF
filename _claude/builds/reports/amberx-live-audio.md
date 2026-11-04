# Report: amberx-live-audio (AmberX live audio)

Opus, branch `claude/amberx-live-audio`, Nov 4 2026. Brett's words are on the build (`origin.said`): Amber offered to
queue the AmberX update so it streams audio live; Brett: "Yeah." Android work is the approved exception to the hold.

**Built on #331** (`claude/live-sessions-plugin`, not merged yet): this branch merges it, so the PR shows both until
#331 lands; then only this build's diff is left. It uses #331's contract and adds to it; no second relay.

## What was built

**Console (live-sessions plugin), `server/live_audio.py` + routes:**
- `POST audio/link`: AmberX's long poll (answers at once on change, else after ≤ 25 s). Picks the session the phone
  streams for (explicit id → a live human row on that device → the row titled like the recorder session → the one
  watched voice session → the newest live voice session). Says `stream` (a voice watcher, or recording with the
  console's recording on), `watchers` + `notice` (the phone's "You're being watched"), `serverNow` (shared clock).
  A linked phone makes the row's voice available (`voice.ok`, `amberx: {device, recording, streaming}`).
- `POST sessions/{id}/audio/frames?stream=`: frames@1 batches (Opus 20 ms, both tracks, `atMs` on the console's
  clock). Seq dedupe per track per run (retries never play twice); answers `listeners`.
- `GET sessions/{id}/audio/live?watcher=`: SSE for voice watchers, frames as they arrive; a watcher whose next frame
  arrived > 3 s ago jumps to the last 0.5 s (`skip`).
- Archive: frames → Ogg Opus segments (~10 s or at a 2 s gap) per track via #331's `Store.add_audio`, so recording,
  compaction, playback and export are unchanged. Ring of 30 s per session in memory.
- Fixed on the way: #331's `GET sessions/{id}/audio/{file}` was registered first and would have taken `audio/live`
  as a file name; the live route now registers before it (the e2e test caught it).

**Watch live player (`web/ui.tsx`):** `useLiveFrames` decodes the frames with WebCodecs (`AudioDecoder`, Opus) and
schedules both tracks on one AudioContext 250 ms behind live; play/pause, mute, volume, Jump to live drive it. While
frames flow the old segment queue is ignored; no WebCodecs = segments only. The watch restarts with voice by itself
when AmberX links mid-watch. No visible UI change (same controls), so no UI Review submission.

**AmberX 0.2.0 (Android):**
- `LiveRules.java` (pure, unit-tested): routes (AmberX's own site only), frames@1 writer, NTP-style clock offset,
  send queue (≤ 10 s, oldest dropped first, put back on failure), retry backoff 0.5 → 1 → 2 → 5 s, link answer
  parsing, the action table (stream / ask consent / stop a live-only recording after 30 s / idle), notification line.
- `LiveStreamer.java`: link thread (started with the AXPP link), two MediaCodec Opus encoders (48 kHz mono, 24 kbps),
  sender thread (one batch in flight, ~200 ms), "You're being watched" ongoing notification (heads-up channel),
  "… wants to listen live" consent notification when the recorder is off (Android asks every start; the recording it
  starts takes the mic, Mic off still wins, and is live-only), partial wake lock only while sending.
- `OutputRecordService`: hands mono PCM to the streamer from the mic reader, the playback reader and the single-track
  pump; tells it when the recorder starts/stops. The 30-minute chunks to axHub are unchanged.
- Manifest: `WAKE_LOCK`. Version 0.2.0 (gradle `versionName`, package, manifests).
- Path: phone → `amberx.amberxai.com/api/console/plugins/live-sessions/…` (AmberX's server, behind axHub's sign-in
  wall, forwards with the console token; hub admins only) → console. The brief said "axHub relays": the hub's wall
  gates it, AmberX's own server forwards it. No axHub code change was needed.

## Tests

| Check | Before | After |
|---|---|---|
| `python3 apps/console-web/plugins/live-sessions/test.py` | 140 | 206 (frames@1, Opus TOC, Ogg CRC/granule, rings, dedupe, lag skip, 10 s cut, target pick, routes, e2e) |
| e2e (real time, uvicorn, simulated phone 2 s × 2 tracks) | — | phone woken 0.51 s after the watch; 200/200 frames; send → listener p50 32 ms, p95 51 ms (server leg) |
| `LiveRulesTest` (JDK 17 container, JUnit 4) | — | 6/6 |
| frames@1 Java bytes vs Python `encode` | — | byte-identical |
| live-sessions `test.mjs` / `core-check.mts` | 4 / 11 | 4 / 11 |
| AmberX `test.mjs` | — | 2214/2214 |
| console `tsc --noEmit`, check-theme, check-controls, check-toolbars, check-plugin-pages, plugin-lifecycle, plugin-commands, help-coverage, project validate | pass | pass |

The full Android build (LiveStreamer, OutputRecordService hooks) compiles only in CI (job `amberx`: unit tests + APK);
no Android SDK on the VPS.

## APK

CI job `amberx` builds `amberx-debug.apk` (versionName 0.2.0, versionCode = run number). When the PR is on main and
that run is green, the console's app catalog files it on axHub's Apps page by itself
(`/projects/_shared/_data/app-catalog/apks/amberx-droid/amberx-droid-0.2.0-b<run>.apk`). Banner item + phone push
"Install AmberX 0.2.0" were sent from this build.

## Manual test (Brett, on the phone)

1. Install AmberX **0.2.0** from axHub → Apps (or the `amberx-debug.apk` CI artifact). Open it once, signed in to axHub.
2. Start a Claude voice session (claude.ai voice through the phone speaker or AmberX).
3. Console → Live sessions: the voice row shows the phone (voice available). Tap **Watch** → voice on.
4. Phone: "Brett wants to listen live" → tap → accept Android's capture prompt. "You're being watched" appears.
5. Console: both sides play about a quarter second behind. Pause/mute/volume/Jump to live work.
6. Close the watch: the notification goes; the live-only recording stops ~30 s later. Recordings → the session has
   Ogg segments for both tracks.
7. Screen off during 4–6: audio keeps coming.

## Not done / gaps (straight)

- **Not tested on a real phone or a real Brett voice call** (headless run, no device). Simulated stream + JVM tests only.
- WebSocket/WebRTC wasn't used: frames go as small HTTP POSTs (~200 ms) and out over SSE; measured server leg is
  ~50 ms p95, so end to end should be ~0.3–0.6 s over mobile data. A WebSocket lane would cut ~200 ms more.
- Android's capture consent can't be skipped: a listener joining while the recorder is off needs one tap on the phone.
- Live frames sit in console memory (30 s); a console restart drops the live lane (archive keeps what was written).
- Calls (voice-communication audio) can't be captured by Android at all; apps that opt out of capture are silent.
- "You're being watched" is a notification (heads-up first time, ongoing), not a drawn overlay.
- If #331 changes its routes before landing, this branch needs a rebase on it.
