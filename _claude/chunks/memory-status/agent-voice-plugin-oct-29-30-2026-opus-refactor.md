<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=180 -->
## Status (as of Oct 21 2026)

- **Agent voice plugin (Oct 29–30 2026, Opus, Refactor build `agent-voice`):** `apps/console-web/plugins/agent-voice` — agents speak their replies with a per-agent voice and narrator (device or cloud voices), a live status light on the banner + Assistant title bar, the Assistant microphone with missing-permission / not-installed popovers, and the page-wide mic lease (mic-lease@1) that AmberX dictation, Speak a command and the Assistant mic share. ai-assistant 0.2.2 gained generic voice slots + window events + a stand-in mic; AmberX native `speak` takes voice/rate/pitch/volume/holdMic (new APK). Doc `apps/console-web/plugins/agent-voice/README.md`. <!-- axf-plugin:agent-voice -->
