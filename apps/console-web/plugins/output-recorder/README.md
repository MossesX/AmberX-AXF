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

## Every session, automatically (Nov 6 2026)

- **Starts by itself:** when a voice, chat or console session calls `claude_session_start`, the Claude sessions plugin
  asks this recorder to start for it (`claude-session/server/recording.py`). A recording already running, or asked for in
  the last 10 minutes, is joined instead of asked for again. Headless builds are skipped. The session that asked stops
  it when it ends, unless another session is on the same recording.
- **What still needs you:** `amberx.recorder_start` stays a straight approval on axHub and Android's capture prompt stays
  on every start. With AmberX allowed to "Display over other apps" the prompt opens by itself; otherwise its notification
  opens it. `mic` is never sent, so your own *Record my mic too* switch decides.
- **Transcribed by itself:** the console finds each uploaded part on the hub, puts it back together, checks its SHA-256,
  and transcribes it with local faster-whisper (`base.en`, 2 threads, lowest priority, its own process, one part at a
  time, only with 2 GB free). The result is `output-recorder/transcripts/<id>.json` (audio-transcript@1) beside the
  recording. No key and no model tokens; nothing leaves the VPS except the model's one download from Hugging Face
  (about 140 MB, kept in the plugin's data folder).
- **Find it:** *Search what was said* on this page (every word, any order, the newest 200 transcripts), Transcript on
  each recording with timed lines, and Transcript on a session in Settings → Plugins → Claude sessions. A session's
  recording group is its session id, which is what links them.
- **Switches:** Settings → Plugins → Claude → Session recording: *Record every session*, *Transcribe every part*.
- **Failures:** a part is tried 3 times. `GET /api/plugins/output-recorder/status` says what is waiting and what failed,
  and the systems check shows **Session transcripts**.

## Limits to know

axHub's data server holds about 100 MB per project: roughly 5 hours at 32 kbps. Delete old recordings, or lower the
quality. A binary upload endpoint on axHub (bigger files, real delete) would lift this; it's an axHub change, not built.

## Files

- Server: `server/transcripts.py` (the worker), `server/whisper_job.py` (one transcription), `server/__init__.py` (status, run, health).
- Web: `web/core.ts` (rules, hub client, transcript search), `web/store.ts` (controller), `web/index.tsx` (page, settings), `web/bridge.ts`.
- Native (AmberX shell, `apps/amberx-droid/android/…/ai/amberx/droid/`): `OutputRecordService` (capture → AAC → chunks),
  `OutputRecordQueue` (settings + local chunks), `OutputRecordUploader` (parts → axHub, confirm, retry, cap),
  `OutputRecordStartActivity` (the one consent flow), `OutputRecordTile`, `OutputRecorderPlugin` (the bridge).
  The capture path is Audio Extract's (PR #187) without the screen; `AudioExtractPlugin.offer` takes the hand-over.
- Test: `node --experimental-strip-types apps/console-web/plugins/output-recorder/test.mts` (or `npx -y tsx …`), `python3 apps/console-web/plugins/output-recorder/test_transcripts.py`.

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
