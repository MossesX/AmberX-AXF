# AmberX: stop the Note saved to Inbox echo loop (`amberx-voice-echo-fix`)

Built together with `gizmo-voice` on branch `claude/gizmo-voice-fix` (Nov 7 2026). Full report: [gizmo-voice.md](gizmo-voice.md).

## What changed

- The notes parser never takes AmberX's own replies ("Note saved to Inbox.", "Moved … to …") as a new note (`isOwnReply`), and the voice plugin drops them before commands and the AI notes parser.
- The speech gate knows Gizmo's voice too, judges a conversation by a stricter likeness bar so Brett's follow-ups still go through, and tells a spoken "stop" from his own reply.
- Regression test: the reply replayed into the listener 12 times (in and past the echo window) still saves one note.
