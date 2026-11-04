# Audio Output Recorder

Records everything the phone **plays** while it's on and keeps it on axHub. **The mic only when you turn it on** (opt-in "Record my mic too", below).

- **Turn it on:** AmberX → Media → Audio out → the switch, or the quick-settings tile **Record audio out**, or say
  "record audio out". Android asks for capture consent every start (its own "Start recording or casting?" prompt) and
  shows a notification while it records, with Stop. The first time it also asks for the audio permission (Android files
  playback capture under it; the mic is opened only for the opt-in mic track) and for notifications.
- **What it can't hear:** phone and VoIP calls (Android never offers call audio to capture) and apps that opt out of
  capture (DRM video, some music apps): those parts are silent. Android 10 or newer.
- **Chunks:** AAC in `.m4a`, 30 minutes each by default, named by start time (`20261030-101500-k3x9`). Silent-all-through
  chunks are skipped (setting). 32 kbps mono by default: about 7 MB per half hour.
- **To axHub:** each chunk is sent as soon as it closes, to the hub's data server (the store AmberX notes use), in its
  own hub project `amberx-recordings` so it never fills the 100 MB that notes, plans and logs share. The data server
  takes text documents of up to 64 KB, so a chunk goes as numbered parts (44 000 audio bytes, base64) plus an index:
  `output-recorder/parts/<id>/0000.json …` and `output-recorder/recordings/<id>.json` (bytes, parts, SHA-256).
  The phone keeps its copy until it reads the index back and it matches; parts already sent aren't sent again.
- **Offline:** chunks wait on the phone (app-private, not in the gallery) and retry 30 s → 15 min, at once when the
  network comes back or AmberX opens. Phone cap 200 MB (setting); when full it **stops** recording (default, nothing
  lost) or drops the oldest unsent chunk (setting). Signed out / hub full: it stops trying and the page says so.
- **Recordings list** (AmberX and the Dev Console, by day): play in the page, share (AmberX; the console downloads),
  delete, and **Audio Extract** (AmberX: the recording is saved to Music/AmberX Recorder and handed over like
  Share → AmberX, for trimming or WAV). The data server has no delete: Delete marks the index and empties every part.

## Limits to know

axHub's data server holds about 100 MB per project: roughly 5 hours at 32 kbps. Delete old recordings, or lower the
quality. A binary upload endpoint on axHub (bigger files, real delete) would lift this; it's an axHub change, not built.

## Files

- Web: `web/core.ts` (rules, hub client), `web/store.ts` (controller), `web/index.tsx` (page, settings), `web/bridge.ts`.
- Native (AmberX shell, `apps/amberx-droid/android/…/ai/amberx/droid/`): `OutputRecordService` (capture → AAC → chunks),
  `OutputRecordQueue` (settings + local chunks), `OutputRecordUploader` (parts → axHub, confirm, retry, cap),
  `OutputRecordStartActivity` (the one consent flow), `OutputRecordTile`, `OutputRecorderPlugin` (the bridge).
  The capture path is Audio Extract's (PR #187) without the screen; `AudioExtractPlugin.offer` takes the hand-over.
- Test: `node --experimental-strip-types apps/console-web/plugins/output-recorder/test.mts` (or `npx -y tsx …`).

## Opt-in mic ("Record my mic too", Nov 1 2026)

- **Off by default.** Settings → Plugins → Audio Output Recorder → Microphone. Turning it on asks Android for the
  microphone only then (AmberX usually has it already: playback capture and hands-free use the same permission).
  A start from axHub can choose for itself: `amberx.recorder_start {…, mic: true|false}` (left out = this setting);
  the approval then reads `Start recording: <session> (Playback + MIC)` or `(Playback only)`.
- **Two tracks per chunk:** stereo AAC, **left = mic, right = playback**, one timeline (`TwoTrack.java`). Same 30-minute
  chunks, names and upload. The index adds `mic: true`, `tracks: {left: "mic", right: "playback"}`, `micBusy`
  (`[{fromMs, toMs, reason}]`) and `micBusyMs`.
- **Mic busy:** when Android won't open the mic or silences it (`AudioRecordingConfiguration.isClientSilenced`, e.g.
  the Claude app's voice mode or a call holds it), the left side is silence, the span is kept in `micBusy` and a
  notification says "Mic busy: recording playback only". The recording never fails over it. Source is
  `VOICE_RECOGNITION` (not privacy-sensitive), so AmberX never takes the mic away from a call or the Claude app; echo
  canceller and noise suppressor are added when the phone has them.
- **Privacy:** the notification reads "Recording: playback + mic" with **Stop mic** (lets go of the mic at once, the
  playback recording goes on). The mic is released whenever the recording stops, and nothing records without the
  approved start (or your own switch / tile) plus Android's capture prompt. The mic picks up anyone in the room.
- **One owner:** a plain capture, no recognizer and no new listener: events still go to the one recorder listener.
