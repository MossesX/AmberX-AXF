# Chat viewer

Every session we have, stored as transcripts in one place: claude.ai text and voice chats, Claude Code sessions and
headless build sessions. Console: **Plugins → Chat viewer** (also **Apps → Chats**); AmberX: **Chats**.

## Where sessions come from

| Source | How it gets in | Stored as |
| --- | --- | --- |
| claude.ai chats (text + voice) | Brett's **data export**: claude.ai → Settings → Privacy → **Export data**, open the email link, download the zip, then **Import export** in the viewer (phone file picker works). Re-import any time: each chat is matched by its uuid. | `cai:<uuid>`, source `claude-ai-text` / `claude-ai-voice` |
| claude.ai chats, pushed by a chat | the **hub drop folder** (below), when Brett says "sync my chats" in a claude.ai session | same id as the export (`cai:<uuid>`), so both merge |
| Claude Code sessions | `~/.claude/projects/<project>/<session>.jsonl` for root and axfbuild, read incrementally (byte offset + size + mtime per file) on a timer and whenever the viewer opens | `cc:<session id>`, `claude-code` |
| Headless build sessions | `/root/axf-builds/*/*.log`, `/home/axfbuild/wt-*/*.log` (+ the worktree's `.brief.md` as Brett's first message) | `build:<hash of path>`, `headless` |

claude.ai has no API for a user's chats, and the viewer never logs in to claude.ai or uses Brett's cookies: chats come
only from the export he uploads or the drop folder.

**Check for updates** runs on load, on the button and every `intervalMin` minutes (Settings, default 10; 0 = only on
load). It reports new / continued / changed / unchanged per source. A continued session (more messages after the ones
we had) appends; a changed one (earlier messages differ, or the file was rewritten) keeps the old copy as a version
you can open from the session's Version picker. A session opened since its last change loses its New / Updated badge.

The console container sees the host folders through read-only mounts that `deploy/install-console.sh` adds from
`deploy/host.sh` (`/hostfs/claude/{root,axfbuild}`, `/hostfs/axf-builds`, `/hostfs/axfbuild-wt/wt-*`; never the whole
axfbuild home). Paths are editable in Settings → Plugins → Chat viewer.

## Store

SQLite (`chats.db`, WAL) in the plugin's data folder `.axf-console/plugins/chat-viewer/` on the console's data volume,
never in git. Why SQLite and not JSON files: full-text search over every message (FTS5), cheap appends for Claude Code
sessions that grow by a few lines per check, transactions (a check cut off half way leaves the last good copy) and one
file to back up. Tables: `sessions`, `messages`, `versions`, `fts`, `cursors`, `runs` (see `server/store.py`).

Every message and title is **redacted on ingest** with session@1's patterns (API keys, GitHub / Slack / AWS / Google
tokens, JWTs, bearer tokens, `password=` / `token:` values, URL credentials, private keys) → `[redacted:<kind>]`, so
secrets are neither shown nor searchable.

## session@1

`framework/core/session-schema.mjs` (JS) = `server/schema.py` (Python, reads `framework/schemas/session.json`);
fixture `framework/spec/fixtures/session.json`, check `node framework/spec/check-session.mjs`.

```json
{
  "$axf": "session@1",
  "id": "cai:<uuid> | cc:<session id> | build:<hash>",
  "source": "claude-ai-text | claude-ai-voice | claude-code | headless | hub-drop",
  "title": "…", "startedAt": "ISO", "updatedAt": "ISO", "project": "amberx-axf or ''",
  "messages": [{ "role": "user | assistant | tool", "text": "…", "at": "ISO or ''", "kind": "speech | text | tool", "toolName": "Bash" }],
  "hash": "chain sha256 (see the schema file)",
  "versions": [{ "version": 1, "hash": "…", "updatedAt": "ISO", "messageCount": 12, "change": "new | continued | changed" }]
}
```

## Hub drop folder (claude.ai sessions write here)

Folder: `/projects/amberx-axf/_data/sessions/claude-ai/<uuid>.json` — through axHub:
`axhub.memory_write` with project `amberx-axf`, area `data`, path `sessions/claude-ai/<uuid>.json`. One file per
conversation; write the whole conversation each time (the viewer sees continued / changed by itself). Either shape is
accepted:

1. **session@1** as above. Required: `"$axf": "session@1"`, `uuid` (the claude.ai conversation uuid), `source`
   (`claude-ai-text` or `claude-ai-voice`), `title`, `startedAt`, `updatedAt`, `messages` with `role` (`user` = Brett,
   `assistant` = Claude) and `text`; `at` and `kind` are optional (voice chats default to `speech`). `id` and `hash`
   may be left out: the viewer makes them.
2. **The export's conversation shape**: `{ "uuid", "name", "created_at", "updated_at", "chat_messages": [{ "sender":
   "human" | "assistant", "text", "created_at" }] }`.

```json
{ "$axf": "session@1", "uuid": "6b7f0d3e-…", "source": "claude-ai-voice", "title": "Chat viewer kickoff",
  "startedAt": "2026-11-01T07:00:00Z", "updatedAt": "2026-11-01T07:20:00Z", "project": "amberx-axf",
  "messages": [{ "role": "user", "text": "Store all our sessions", "at": "2026-11-01T07:00:00Z" },
               { "role": "assistant", "text": "Say less, boss.", "at": "2026-11-01T07:00:05Z" }] }
```

A file that doesn't validate is skipped and named in the check's problems list with the field that's wrong.
**"Sync my chats"** (shared rule): the claude.ai session uses `recent_chats` / `read_conversation` and writes each new
or updated conversation here.

## Audio export (two voices)

Session view → **Audio**: pick where the voices come from, Brett's voice, Amber's voice and a message range, then
**Make audio**. Only spoken and text turns are read (tool calls and results are skipped; code blocks and links are
shortened), with a short pause between turns and a chapter at every hour of the conversation's clock. It renders in
the background with progress (one at a time) and lands on the hub at `/projects/amberx-axf/_data/chat-viewer/audio/`
(`<title>-<time>.mp3` + a `.json` sidecar with the voices, range, duration and chapters), with a player (chapter
buttons seek) and a download link in the viewer.

- **Piper** (default, free, offline, CPU): **Set up free voices** once (Settings or the Audio panel) makes a venv in the
  data folder (`tts/venv`: `piper-tts` + `lameenc` for MP3) and downloads the two voice models from Hugging Face
  `rhasspy/piper-voices` (`tts/voices/`, ~60 MB each). Defaults: Brett = `en_US-ryan-medium`, Amber = `en_US-amy-medium`.
- **OpenAI** / **ElevenLabs**: save a key in Settings → Plugins → Chat viewer (0600 in the data folder, never sent to
  the browser) or set `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` on the console. The key reaches the renderer process in
  its environment only.

## Server routes

See the top of `server/__init__.py`. Self-test: `python3 apps/console-web/plugins/chat-viewer/test.py` (98 checks;
`CHAT_VIEWER_PIPER_TTS=<tts folder>` adds a real two-voice Piper render).

## Known gaps

- MP3 files carry no embedded ID3 chapter frames; chapters are in the sidecar and the viewer's chapter buttons.
- In AmberX, an export upload larger than 12 MB is refused by AmberX's console forwarder: upload big exports from the
  console. Playback and everything else works there.
- New axfbuild worktrees (`/home/axfbuild/wt-*`) are seen by the console after the next `install-console.sh` run.
