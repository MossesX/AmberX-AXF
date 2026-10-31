# Audio Output Recorder

Records everything the phone **plays** while it's on and keeps it on axHub. **Never the microphone.**

- **Turn it on:** AmberX → Media → Audio out → the switch, or the quick-settings tile **Record audio out**, or say
  "record audio out". Android asks for capture consent every start (its own "Start recording or casting?" prompt) and
  shows a notification while it records, with Stop. The first time it also asks for the audio permission (Android files
  playback capture under it; the recorder never opens the mic) and for notifications.
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
