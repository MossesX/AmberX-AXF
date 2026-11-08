<!-- memory-chunk@1 source=_claude/THREADS.md tokens=217 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| AmberX recorder: opt-in mic so both sides of a session get recorded (recorder-mic, Opus, headless): "Record my mic too" (off by default), `recorder_start` `mic` arg + approval "Playback + MIC", stereo chunks L=mic R=playback, mic-busy fallback (marked + notification), Stop mic, released on stop, no new listener | deploy | main (direct push, Brett's brief) + axHub `claude/recorder-mic` (push banner opens the PR) | — | output-recorder 18→24, JUnit TwoTrack 9 + RecorderControl mic, AmberX 2143/2143, axHub 517/517 (Node 22). Install the new AmberX APK (CI `amberx-debug.apk`); axHub branch must merge for the approval title. Shots: UI Review → Screenshots "Recorder mic - Nov 1" (no native notification shot: no emulator). Report `_claude/builds/reports/recorder-mic.md` | 2026-11-01 |
