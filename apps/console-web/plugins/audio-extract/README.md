# Audio Extract

Pulls the audio out of videos on the phone, screen recordings first, and records the screen with the sound apps play.
Runs in **AmberX on Android** (target `amberx-droid`); on the console it only shows a note. Built Oct 30 2026 (Opus).

## What it does

- **Extract:** *Pick videos* (several at once, run one after another), *Last screen recording*, *Trim or pick a track*,
  **Share → AmberX** from the Gallery, and (opt-in) a *New screen recording: extract audio?* card when one appears in
  Movies or DCIM → Screen recordings (or straight away with auto-extract on). Progress and Cancel per file and for the batch.
- **Formats:** **M4A** = the original AAC track copied out with MediaExtractor + MediaMuxer, no re-encode (lossless,
  fast). **WAV** = decoded with MediaCodec to 16-bit PCM, only when picked. A video whose audio isn't AAC can't become an
  M4A as is: it says so and you pick WAV. No MP3: Android has no MP3 encoder built in (it would mean bundling one).
- **Output:** `Music/AmberX Audio` (setting) through MediaStore. No storage permission: the picker grants each video.
- **Files:** play, share, rename, delete.
- **Record:** MediaProjection + MediaCodec (H.264 + AAC) + MediaMuxer, with **app playback audio** (AudioPlaybackCapture,
  Android 10+). Foreground service (type `mediaProjection`) with a notification (Pause / Resume / Stop), a floating chip
  (elapsed, Stop) when "Display over other apps" is allowed, a countdown. When it stops, the video goes straight through
  the extractor: video + audio, or audio only (the video is deleted once its audio is saved).
- **No microphone, anywhere.** If an app blocks capture of its sound, its audio is silent; the Record tab says so before
  you start. Android requires the record-audio permission for playback capture (AmberX already holds it for voice); the
  recorder never opens the microphone.
- **Voice:** "extract audio from my last screen recording", "start screen recording", "stop recording", "pause recording",
  "resume recording", "open audio extract".

## Pieces

| Path | What |
| --- | --- |
| `web/core.ts` | Pure rules + the controller: names, trim, formats, settings, batch queue, recorder state machine |
| `web/bridge.ts` | The native seam (`AudioExtract` Capacitor plugin, found through the page's Capacitor global) |
| `web/fake.ts` | Fake native bridge for tests |
| `web/index.tsx` | Page (Extract · Record · Files), settings, actions, voice phrases |
| `test.mts` | Self-test: `node --experimental-strip-types apps/console-web/plugins/audio-extract/test.mts` |
| `apps/amberx-droid/android/…/AudioExtractPlugin.java` | Picker, probe, extract, MediaStore files, folder watch, share-in |
| `apps/amberx-droid/android/…/AudioExtractor.java` | Lossless copy (MediaMuxer) and WAV decode (MediaCodec) |
| `apps/amberx-droid/android/…/ScreenRecordService.java` | The recorder service, notification and chip |
