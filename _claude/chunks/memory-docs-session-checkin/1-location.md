<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md lines=30-38 tokens=119 -->
### 1. Location
Where is this session running?
- **VPS terminal:** Claude Code over mosh on the Hostinger VPS. Detected from the hostname, the presence of `/opt/axhub`, and the `MOSH_*` / `SSH_CONNECTION` variables.
- **Cloud container:** Claude Code on the web or phone. Detected from the remote-session environment markers.
- **Desktop / laptop:** local Claude Code.
- **claude.ai:** a chat or Project, so there's no shell.

The answer decides which of questions 2–5 apply.
