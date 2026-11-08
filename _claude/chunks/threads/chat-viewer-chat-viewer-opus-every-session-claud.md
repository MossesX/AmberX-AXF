<!-- memory-chunk@1 source=_claude/THREADS.md tokens=210 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Chat viewer (chat-viewer, Opus): every session (claude.ai text + voice via export upload or the hub drop folder "sync my chats", Claude Code JSONL incremental, headless build logs) as session@1 in SQLite + FTS5; check for updates on load (new / continued / changed, versions), redaction on ingest, DataGrid list, search → jump, bubbles, export; two-voice audio export (Piper free, OpenAI / ElevenLabs) with chapters, on the hub; console plugin + AmberX "Chats" | done (tests green) | `claude/chat-viewer` → main | — | Re-run `install-console.sh` once for the read-only session mounts; tap Set up free voices. Screenshots: UI Review → Screenshots "Chat viewer - Nov 1". Report `_claude/builds/reports/chat-viewer.md` | 2026-11-01 | <!-- axf-plugin:chat-viewer -->
