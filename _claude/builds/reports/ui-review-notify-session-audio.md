# ui-review-notify-session-audio

Brett (voice): "Anything that's ready for UI review, send me a notification through the AmberX." "Yeah, I want you to
build it and it's not open on the phone. I want this, the audio... automatically audio built in transcriptions automatic
every session."

## 1. UI Review notifications

- `ui-review/server/notify.py`: one console alert per group, `<build>: <n> items waiting`, link `?axf-review-group=<id>`.
  It refreshes as items are added and clears when everything is decided. Plain code, no tokens.
- AmberX's watch already reads `/api/alerts`. It now honours the alert's `link` (Brett's own sites only, else the console)
  and `meta.label`, and an update replaces the notification without a second buzz.
- UI Review opens filtered to the group, with Show everything.
- Delay: the watch's check interval (30 s by default). It needs the watch switched on and a console sign-in in AmberX's
  WebView, as every console alert does.

## 2. "Opened UI Review" with nothing on the phone

Live log before the fix: `ui review … ok: true, how: woke via AmberX`. Causes, every one a false success:

| Where | What was wrong | Now |
| --- | --- | --- |
| `AxppLink.openUrl` | Android 10+ drops a blocked background start without raising anything, so `opened` was true whenever nothing threw; `notified: true` was hard-coded | `opened` only with a window behind the start, `notified` is measured, `overlay` is reported |
| Same | Since Android 15 holding Display over other apps isn't enough, a visible overlay is required (target SDK is 36) | a 1 px transparent overlay is up for the start; the recorder's consent prompt uses the same path |
| Same | Notification said "Amber is opening the console" and lasted 2 min | "Tap to open the Dev Console", 10 min |
| `wake.py` | any non-error answer counted as sent, a held call included | reads the phone's answer and says what happened |
| `console-commands` | `delivery.how` said woke when the phone said yes | only the console that opened from the link counts; a wake that reached nobody raises a tappable alert, cleared on delivery |
| `follow-amber` | `ok` on a queued command answered "opened X" | `shown: false, queued: true` and the real reason; a connected tab that never answers (frozen) is queued for the next console |

## 3. Every session recorded and transcribed

- `claude-session/server/recording.py`: `session-start` asks the recorder for voice, chat and code sessions, joins a
  recording already running or asked for in the last 10 minutes, skips headless, and stops it when the owning session ends.
- `output-recorder/server/`: a worker reassembles each part, checks its SHA-256, transcribes with local faster-whisper
  (`base.en`, 2 threads, nice 19, own process, one at a time, 2 GB memory floor), and writes `transcripts/<id>.json` beside
  the recording. Up to 3 tries, then the systems check shows it.
- Audio out: search what was said, transcript on each recording. Claude sessions: Transcript button on each session.
- Settings: `recording.autoStart`, `recording.transcribe`, `notify.uiReview` (Settings → Plugins → Claude).
- `output-recorder` is now enabled by default, because its server part does the transcribing.

### Still two taps per recording

`amberx.recorder_start` is a straight approval on axHub (decision #108, never auto-approved) and Android's capture prompt
appears on every start. Both were kept: the first is Brett's own rule, the second can't be skipped. Dropping the axHub
approval is his call and an axHub change.

## Tested

| Check | Before | After |
| --- | --- | --- |
| ui-review test.py | 196 | 206 |
| console-commands server | 72 | 82 |
| follow-amber | 33 | 35 |
| claude-session | 57 | 71 |
| output-recorder test.mts | 24 | 26 |
| output-recorder test_transcripts.py | none | 20 |

Also clean: console `tsc`, `vite build`, check-theme, check-controls, check-toolbars, check-chrome-assets, help coverage,
plugin-lifecycle on the changed plugins, test_alerts, test_mcp_tools, check-ui-review.

Real engine: an 11 s speech clip packed like the phone packs it (stereo AAC, left silent, right speech, split into hub
parts, SHA-256 checked) came back as "And so my fellow Americans asked not what your country can do for you, asked what
you can do for your country." The real word is "ask": `base.en` isn't perfect.

The first real run failed and the fake engine had hidden it: `av` 19 removed an argument faster-whisper 1.2.1 passes, so
every transcript would have failed. `av>=17,<19` is pinned; 18.1.0 is the version proven.

## Not tested

- **No phone.** Nothing here ran on a real device: the overlay start, the notification tap and Android's prompt are
  untested. The Java was only scanned for syntax in a JDK container; CI compiles it and runs the JUnit tests.
- **A real 30-minute part.** Speed is measured on 11 s only (2.7 s including the model load). Expect minutes per part.
- `whisper_job.py` has run in a `python:3.12-slim` container, not in the console image, until this deploys.

## Needs after merge

- A new AmberX APK for the phone half (link, label, honest answers, overlay start). Until then notifications arrive but
  a tap opens the console's front page, and the old APK still answers `opened: true`; the console no longer believes it.
- AmberX needs Display over other apps for pages to open by themselves. Without it the answer says so and the tappable
  notification does the job.
- The console image grows about 450 MB. The VPS disk is at 96% (8 GB free), and the model adds about 140 MB on first use.
- Android side stays AmberX only (allowed exception). No framework Kotlin changed.
