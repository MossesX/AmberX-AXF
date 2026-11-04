# Live sessions

Every Claude session going on, on every account, and who is running it (Brett, Nov 4 2026). Built on Opus
(orchestrator build `live-sessions-plugin`). Capability `axf.claude-live@1`. No model is ever called.

## What it shows

- **Grid** (default; list optional) of every session: **Human** (Claude Code terminals, claude.ai chats and voice calls
  through the axHub connector, the AmberX / Gizmo companion) and **Headless** (`claude -p` builds, agent-swarm jobs).
  Each card: the agent's avatar, name and title, the Human / Headless badge, account, device, app, what it is on, step,
  progress, time, cost, model and thinking, a live pulse, and chips for *Watched* and *Recording*. Cards fold to avatar
  + name. Filters: All / Human / Headless, account, agent, search, ended too.
- **Widget:** a framework `status` asset on the banner, `2 human · 4 headless`; tap opens the grid. Counters
  `live.sessions.human`, `live.sessions.headless`, `live.sessions.watched` for other widgets. Settings → Widget hides it.
- **Who's running this session?** Brett picks the agent on a human card (or `claude_session_start`'s picker). The last
  pick per account + device is the next default. One agent can't run two live human sessions: the pick is refused with
  the free agents to offer instead.

## Watch live

- Brett only (his signed-in click). Helpers see the list, not the stream. Every start, stop and refusal is in the
  **Watch log**.
- Text for every session: messages, tool calls with arguments, results (secrets redacted). Headless rows stream their
  build's stream log (`<worktree>/<name>.jsonl`).
- **Voice only on human sessions** whose device runs AmberX: both sides (mic + Claude) as they arrive
  (`POST sessions/{id}/audio`). Play / pause, mute, volume, jump to live, pop out. Without AmberX: text only and
  "Voice needs AmberX on that phone" with the setup steps. Headless rows have no voice controls.
- **Live voice from AmberX (live-audio@1, Nov 4 2026):** see *Live voice* below. Frames play about a quarter second
  behind live; the ~10 s segments are the fallback where the browser has no WebCodecs.
- **"You're being watched"**, always on, on human sessions while anyone watches: the Claude Code hook shows it as a
  system message, a bell alert (pushed to AmberX), and a line in the Breakroom group chat naming who is watching. It
  goes off when the last watcher leaves (or stops sending heartbeats for 45 s). Headless watches are only logged.

## Live voice (AmberX, live-audio@1)

AmberX 0.2.0+ streams both tracks its recorder captures: **mic** (Brett) and **tts** (what the phone plays, i.e. Claude's
voice), as Opus packets of 20 ms, about 200 ms per POST, stamped on the console's clock (the phone keeps the offset
from `serverNow` in every link answer). Path: phone → AmberX's own site (`amberx.amberxai.com`, behind axHub's sign-in
wall, forwards `/api/console/plugins/live-sessions/…` with the console token) → this plugin. One contract, no second
relay.

1. **Link** — AmberX long-polls `POST audio/link {device, name, recording, mic, recSession, streaming, stats, known,
   wait}`. The answer returns at once when it changes: the session to stream for (the id it was given, else a live
   human row on that device, else the row titled like the recorder session, else the one watched voice session, else
   the newest live voice session), `stream` (a voice watcher is on it, or the phone records and recording is on),
   `watchers` + `notice` (the phone's *You're being watched* notification) and `serverNow`. A linked phone makes
   its session's voice available (`voice.ok`, `amberx: {device, recording, streaming}` on the row); the link is gone
   70 s after its last poll.
2. **Frames** — `POST sessions/{id}/audio/frames?stream=<run id>` with a frames@1 body (`server/live_audio.py`,
   `LiveRules.java`: `AXLA` 1, then `track u8 · seq u32 · atMs i64 · len u16 · Opus`). Retries are safe (seq per
   track per run). Answers `listeners` so the phone stops at once when nobody listens and it isn't recording.
3. **Listen** — `GET sessions/{id}/audio/live?watcher=` (voice watchers only): `frames` events as they arrive
   (base64 Opus, session time `t`), `skip` when a watcher's next frame arrived more than 3 s ago (it jumps to the last
   0.5 s). The player decodes with WebCodecs and schedules both tracks on one AudioContext, 250 ms behind.
4. **Archive** — frames are folded into Ogg Opus segments (~10 s, or at a 2 s gap) per track and stored like any
   voice segment (`audio/raw/<track>-<offset>.ogg`), so recordings, compaction, playback and export need nothing new.
   The phone's own 30-minute chunks to axHub carry on unchanged.

On the phone: if someone listens and the recorder is off, AmberX asks for Android's capture consent (a *wants to
listen live* notification; Android asks on every start) and records with the mic; that recording is *live-only* and
stops 30 s after the last listener leaves. The ongoing *You're being watched* notification shows while anyone watches
and goes when the last one leaves. Backpressure: at most 10 s of frames wait on the phone (oldest dropped first);
failed sends retry 0.5 → 1 → 2 → 5 s and resume. Screen off: the recorder's foreground service keeps capturing; a
partial wake lock is held only while frames go out.

## Recording and playback

- Every human session is recorded, on by default: a timestamped event log of the context window (context loaded, every
  turn, tool calls and results, compaction, errors) on one session clock, plus both voice tracks. Secrets are redacted
  before saving. The watched side shows **Recording** while it is on.
- **Session recordings** (its own view): search across every transcript, favourites, pin (keep forever), export
  (.zip), delete (Brett, logged). **Player:** real-time replay of the context window in sync with the audio, scrub with
  markers (tool calls, builds, approvals, errors, compactions), 0.5x–4x, skip silence, play from any message, and
  *In context now* (tokens and what had been compacted).
- **Silence compaction** after a session ends (low priority, resumable): energy VAD on both tracks keeps only speech
  (± 200 ms) as Opus chunks with their exact start on the session clock; the gaps are timeline, not bytes. Verified
  (chunk spans inside the raw files, lengths, transcript times) before the raw audio is purged after 24 h (setting).
  Bytes saved show in the browser and settings. Needs `ffmpeg` in the console image for anything but WAV.
- Retention 90 days (setting), size cap with bell alerts at 80 % / 100 %, space used in settings.

## Storage (Settings → Plugins → Live sessions → Recordings › Storage)

- **Its own container** is the primary: the working store (`AXF_RECORDINGS_DIR`, else the plugin's data folder on the
  console's data volume, never the repo). **Move** it to another path: preview, then copy + SHA-256 check + delete.
- Mirrors, synced in the background (append-only, so no conflicts), each with synced / pending / error:
  **VPS container** (dropdown of running containers + a path, through Container access), **Repo** (dropdown of the
  GitHub App's repos, Git LFS on its own branch; **public repos are refused** unless Brett ticks *I understand*),
  **Local** (a device keeps a copy and reports it with `POST storage/local-ack`).

## Claude Code hook

`node apps/console-web/plugins/live-sessions/live.mjs hook-config` prints the hooks block for `~/.claude/settings.json`
(SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd → `live.mjs hook`). It checks the session in, sends new
transcript lines, and prints the notice when it changes. Needs `AXF_CONSOLE_URL` + `AXF_TOKEN`; `AXF_ACCOUNT` (or the
`CLAUDE_CONFIG_DIR` folder name) names a helper account. Headless runs skip it.

## Troubleshooting

- **"Voice needs AmberX on that phone":** no AmberX 0.2.0+ is linked for that session. Install it, open it once and
  sign in to axHub; it links within seconds (the row then says the phone). If the wrong session gets the voice, start
  the recording with the session's name (`amberx.recorder_start`, `session_name` = the session's title).
- **Voice watch on, but silence:** the phone shows *… wants to listen live*: tap it and accept Android's capture
  prompt (Android asks every start). Mic off on the phone wins (Claude's side only). Old browsers without WebCodecs
  get the ~10 s segments instead.
- **A Claude Code session isn't listed:** the hook isn't installed on that machine (`live.mjs hook-config`), or
  `AXF_TOKEN` / `AXF_CONSOLE_URL` aren't set in its shell. Headless runs never use the hook; they show from tmux.
- **"Only Brett can watch":** watching, recordings and storage need Brett's own signed-in console session; a console
  token alone (or a Claude session, an agent) is a helper.
- **Storage target in *error*:** the message says why (public repo, no container picked, git-lfs missing, Container
  access off). Fix it and save again; mirrors retry every minute.
- **Compaction says "wav (ffmpeg missing)":** the console image has no ffmpeg yet; redeploy the console.

## Commands

| What | REST (`/api/plugins/live-sessions/…`) | MCP / CLI |
|---|---|---|
| List every session | `GET sessions?kind=human\|headless&account=&agent=&q=&ended=true` | `live_sessions_list` · `live.mjs list [--human\|--headless]` |
| Check a session in | `POST checkin {id, client, account, device, app, title, agent, …, lines}` | `live_sessions_checkin` · `live.mjs hook` |
| Am I being watched? | `GET sessions/{id}/notice` | `live_sessions_notice` · `live.mjs notice <id>` |
| Watch (Brett) | `POST sessions/{id}/watch {voice}` → `GET sessions/{id}/stream?watcher=` (SSE) | console only |
| Recording settings / storage | `GET settings`, `GET storage` | `live_sessions_settings`, `live_sessions_storage` |
| Recordings (Brett) | `GET recordings?q=`, `GET recordings/{id}`, `…/context?t=`, `…/export`, `DELETE recordings/{id}` | console only |
| Voice segment (AmberX) | `POST sessions/{id}/audio?track=mic\|tts&offsetMs=&ext=` (raw bytes) | AmberX |
| Live link (AmberX) | `POST audio/link {device, name, recording, recSession, known, wait}` (long poll) | AmberX |
| Live frames (AmberX) | `POST sessions/{id}/audio/frames?stream=` (frames@1) | AmberX |
| Listen live (Brett) | `GET sessions/{id}/audio/live?watcher=` (SSE, voice watch) | console only |

Example: `curl -H "Authorization: Bearer $AXF_TOKEN" "$AXF_CONSOLE_URL/api/plugins/live-sessions/sessions?kind=human"`.
Voice commands come from the commands above through plugin-commands@1 (Molly: "list live sessions", "am I being watched").

## Privacy

- Watching is Brett's only, always logged, and a human session always shows *You're being watched* while anyone
  watches (not a setting). *Recording* shows whenever it records.
- Tokens, keys, passwords and JWTs are redacted from every saved line and tool argument before it reaches disk.
- Recordings stay off the repo by default; a public repo needs Brett's *I understand*. Retention 90 days unless pinned.

## Files and lifecycle

- Server: `server/sessions.py` (rows, classifier, watch policy, watchers), `server/recordings.py` (store, redaction,
  timeline, VAD compaction, retention, targets, move), `server/lines.py` (transcript / stream-json → events), `server/live_audio.py` (live-audio@1: frames@1, Opus timing, Ogg
  writer, rings, device links),
  `server/__init__.py` (routes, sweep). Docs: this file. Web: `web/core.ts`, `web/ui.tsx`, `web/index.tsx`. Hook: `live.mjs`.
- Data: `.axf-console/plugins/live-sessions/` (state.json, audit.jsonl, recordings/). `AXF_LIVE_DIR` moves it.
- Tests: `python3 apps/console-web/plugins/live-sessions/test.py`, `node …/test.mjs`, `npx -y tsx …/web/core-check.mts`.
- Remove: `node apps/console-web/plugins/live-sessions/uninstall.mjs --all`.

## Gaps

- Live voice (AmberX 0.2.0, live-audio@1) is tested end to end with a simulated phone (`test.py`) and the Java rules
  in a JDK; not yet against a real phone call. Android's capture consent can't be skipped: a listener joining while
  the recorder is off needs one tap on the phone.
- Live frames sit in console memory (30 s per session); a console restart drops the live lane (the archive keeps what
  was written; the phone re-links within seconds).
- The phone's *You're being watched* is a notification, not a drawn overlay.
- claude.ai chats can't show the notice inside claude.ai; they get the bell alert and the Breakroom line.
- One-tap creation of a dedicated `axf-recordings` Coolify container isn't built: "its own container" is a dedicated
  folder on the console's data volume, movable with Move.
- Dragging a build onto a card to send it to that session waits for the handoff session channel (handoff-2), which can
  subscribe to this plugin's stream (`axf.claude-live@1`).
