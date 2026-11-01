# Chat viewer — report (Nov 1 2026, Opus, branch `claude/chat-viewer` → main)

Brett, Nov 1 ~3 AM: store ALL our sessions (claude.ai text + voice chats, Claude Code sessions, headless build
sessions) as transcripts in a viewer that checks for updates when it loads, and export any session as audio with two
voices (Brett and Amber).

## What landed

| Part | Where |
| --- | --- |
| session@1 schema: validator, redaction patterns, chain hash, JSON Schema | `framework/core/session-schema.mjs`, `framework/schemas/session.json`, `framework/schemas/json/session.schema.json` (written by `axf schemas`) |
| Conformance | fixture `framework/spec/fixtures/session.json`, check `framework/spec/check-session.mjs` (37, in CI); Python port replays it |
| Console plugin `chat-viewer` (also AmberX "Chats") | `apps/console-web/plugins/chat-viewer/` |
| Store | SQLite + FTS5 `chats.db` in `.axf-console/plugins/chat-viewer/` (console data volume, not git) |
| Ingesters | `server/ingest.py`: claude.ai export (zip / conversations.json), Claude Code JSONL (incremental), build logs, hub drop folder |
| Audio | `server/audio.py` (jobs, Piper setup, chapters) + `server/tts_worker.py` (renderer process) |
| Viewer | `web/ui.tsx`: DataGrid list, search, bubbles, versions, export, audio panel + player, settings tab |
| Host mounts | `deploy/host.sh` (read-only), wired in `deploy/install-console.sh` (marked lines) |
| Rule | shared `RULES.md`: "Sync my chats" → claude.ai sessions write `sessions/claude-ai/<uuid>.json` through axHub |
| Docs | plugin `README.md` (hub drop schema), `install_steps.md` Part K (steps 36–38), plugins README, STATUS, PORTING |

## How Brett gets his claude.ai chats in

claude.ai has no API for a user's chats, and the viewer never logs in or uses his cookies. Two ways:

1. **Data export (everything, any time):** claude.ai → **Settings → Privacy → Export data** → open the emailed link
   → download the zip → in the viewer tap **Import export** and pick the zip (the phone's file picker works). Re-import
   later exports whenever: each chat is matched by its uuid, so new ones are added, continued / changed ones updated
   (old copies kept as versions). Exports over 12 MB must be uploaded from the console (AmberX's forwarder caps
   uploads at 12 MB).
2. **"Sync my chats" (between exports):** in any claude.ai chat, say "sync my chats". Per the new shared rule, that
   session uses `recent_chats` / `read_conversation` and writes each new or updated conversation to the hub drop
   folder (`axhub.memory_write`, project `amberx-axf`, area `data`, path `sessions/claude-ai/<uuid>.json`, session@1).
   The viewer ingests the folder on its next check. Same uuid as the export, so the two merge into one session.

Voice chats: the export has no documented voice flag; a chat is marked voice when any of its fields names voice
(`input_mode` etc.). Drop files say it outright (`source: claude-ai-voice`).

## Behaviour

- **Check for updates** on load, on the button, and every 10 min (setting; 0 = only on load). Reports new / continued /
  changed / unchanged per source. Claude Code files are read from the last byte offset (a half-written last line waits
  for the next check); a shrunk / rewritten file is re-read whole and stored as a change.
- **Versions:** every check that changes a session adds a version. A continuation keeps no copy (the old version is the
  first N messages); a change keeps the replaced messages, readable from the session's Version picker.
- **Redaction on ingest** for every source (API keys, GitHub / Slack / AWS / Google tokens, JWTs, bearer tokens,
  `password=` / `token:` values, URL credentials, private keys) → `[redacted:<kind>]`; never stored, never searchable.
- **Search:** FTS5 over every message and title, prefix on the last word, snippets with the hit marked (drawn as text,
  not HTML); tapping a hit opens the session scrolled to that message and outlines it.
- **Session view:** Brett right, Amber left, timestamps, mic mark on spoken turns, tool calls folded into one
  collapsible run (toggle), copy, share (phone share sheet, else copy), export Markdown / text (and JSON via the API).
- **Audio:** pick engine, Brett's voice, Amber's voice, a message range → background job with progress; tool turns
  skipped, code blocks / links shortened, a pause between turns, a chapter at every clock hour; MP3 (or WAV) +
  `.json` sidecar on the hub `/projects/amberx-axf/_data/chat-viewer/audio/`; player with chapter buttons, download,
  delete. Piper is free on the VPS (Set up free voices once: venv + `piper-tts` + `lameenc`, voices from Hugging Face);
  OpenAI / ElevenLabs used when picked and a key is saved (0600, server only) or set in the environment.

## Why SQLite (Brett asked me to justify)

Full-text search over ~40k messages (FTS5 ships with Python), cheap appends for Claude Code sessions that grow every
few minutes (JSON files would be rewritten whole), transactions so a cut-off check keeps the last good copy, one file
to back up. Real run on this VPS: first check 11 s for 187 sessions (103 Claude Code, 84 build logs, 40,039 messages),
the next check 0.1 s.

## Tests

| Check | Result |
| --- | --- |
| `node framework/spec/check-session.mjs` | 37 passed |
| `python3 apps/console-web/plugins/chat-viewer/test.py` | 98 passed (host), 99 in the console container with `CHAT_VIEWER_PIPER_TTS` (real two-voice Piper MP3, 3.6 s sample) |
| Covers | export zip + bare JSON, voice detection, project names, new / continued / changed / unchanged, versions + old messages, JSONL incremental (offset, half line, tool names across increments, rewrite = change), build logs, hub drop (both shapes, bad file named with field, merge with export), redaction everywhere, search (snippet, seq, titles, prefix, odd queries, secrets not searchable), md / txt / json export, settings merge, keys never returned + 0600, audio: two voices measurably different (tone engine), silence between turns, chapters per hour, range, sidecar, file served + deleted, stored on the hub |
| Local CI block (Node sweep) | all green: validate, tracker, plugins --check, project manifests, fixtures, catalog, axf-server, build steps, profiles, feature matrix, builds store + verify, github, ui-review, session, libraries, theme, controls, plugin pages |
| Console `tsc --noEmit` (re-baked) | clean |
| menu-reach | ok (303 checks) |
| Plugin lifecycle | `check chat-viewer` clean; `uninstall --all` in a clean copy + `--after-uninstall` clean |
| AmberX re-bake + build | builds, `chat-viewer` in `console-plugins.json` |
| Console server smoke | plugin mounts, 401 without the token |
| Not run locally | theme-swap (Playwright over the built console) — CI runs it |

The full local lifecycle loop also lists other plugins failing, but only on untracked `sessions/archive/**` files in
this worktree (session-checkin's archive), which CI never sees.

## Screenshots

UI Review → Screenshots, group **Chat viewer - Nov 1** (10 shots, phone + desktop, demo sessions only): Chats list,
search hit, voice chat session (with a redacted key), audio export panel + player with chapters, Claude Code session
with folded tool calls. Taken just before the page head got its one-line description (check-plugin-pages).

## Known gaps

- MP3s have no embedded ID3 chapter frames; chapters live in the sidecar and the viewer's chapter buttons.
- AmberX: uploads over 12 MB refused by its console forwarder (import big exports from the console).
- New `/home/axfbuild/wt-*` worktrees reach the console after the next `install-console.sh` run (one mount each; the
  axfbuild home itself is never mounted because it holds git credentials).
- The console needs that installer re-run once to get the read-only mounts; until then the viewer shows only what the
  container itself has (its own Claude Code sessions) plus imports and the hub drop folder.
- Piper isn't installed until someone taps **Set up free voices** (~130 MB with two voices).
- The export's voice-mode detection is heuristic (no documented field).
