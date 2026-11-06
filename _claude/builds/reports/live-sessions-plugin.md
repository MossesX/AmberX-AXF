# Report: live-sessions-plugin (Live sessions plugin)

Opus, agent Ping Paulie, branch `claude/live-sessions-plugin`, Nov 4 2026. Brett's words are on the build (origin.said)
with addenda 1–5; addenda 6–9 were in the worktree brief (`.brief.md`) and are covered below.

## What was built

New console plugin `apps/console-web/plugins/live-sessions` (`ai.amberx.axf.console.live-sessions`, `forFramework: true`,
targets console, Molly, AmberX, axHub web), capability `axf.claude-live@1`. Docs: `apps/console-web/plugins/live-sessions/docs/README.md`.

- **Every session, human and headless:** rows from the plugin's own check-ins (Claude Code hook, AmberX/Gizmo, helper
  accounts), `axf.session-feed@1` (claude.ai chats/voice through the axHub connector) and `axf.headless@1` (tmux
  `axf-…` runs + meters). Classifier: client headless/swarm, `AXF_SURFACE=headless`, tmux `axf-`, SDK entrypoint =
  headless; everything else human. Human/Headless badge, agent avatar + name + title, account, device, app, doing,
  step, progress, model, thinking, time, cost, live pulse. Grid (default, foldable cards) or list; filters All / Human /
  Headless, account, agent, search, ended.
- **Widget:** a framework `status` asset on the banner (`3 human · 1 headless`) + counters `live.sessions.*`.
- **Agent per session:** pick on the card (Brett); last pick per account + device is the default; one agent can't run
  two live human sessions (409 with free agents offered).
- **Watch live:** Brett only (`request.state.axf_user` session + admin, agent headers refused), audited (start, stop,
  refused, heartbeat timeout). Text for every session via SSE (human: recorded events; headless: its stream log).
  Voice only on human rows with AmberX; play/pause, mute, volume, jump to live, pop out; text-only + setup steps
  otherwise. **"You're being watched"** on human sessions: hook systemMessage, bell alert, Breakroom line naming the
  watcher (new `post()` on `axf.crew@1`); off when the last watcher leaves. Headless: logged only.
- **Recording (on by default):** redacted context-window event log on one session clock + mic/tts audio segments;
  "Recording" notice. Session recordings view: search across transcripts, favourites, pin, export zip, delete (Brett,
  logged). Player: real-time replay synced with audio, scrub + markers, 0.5x–4x, skip silence, play from any message,
  *In context now*.
- **Silence compaction:** energy VAD, ±200 ms pad, speech chunks with exact start offsets, Opus via ffmpeg (WAV
  without), verified before raw purge after 24 h; bytes saved shown. Console image now installs `ffmpeg` + `git-lfs`.
- **Storage:** own container (primary working store; Move with hash verification), mirrors in a VPS container (via
  `axf.containers@1`), a repo (Git LFS branch; public repos refused without Brett's *I understand*), local devices
  (status by device report). Retention 90 days, pins, size cap alerts, space used.
- **Claude Code hook:** `live.mjs hook` (+ `hook-config`, `list`, `notice`).
- Plan Studio plan `claude-sessions-list-molly-plugin-wpo6` → dropped, tagged superseded, linked to this build.

## Tests

- `python3 apps/console-web/plugins/live-sessions/test.py`: 140 checks (engines, routes through FastAPI TestClient with
  fake sources, owner-only, voice rules, notices, Breakroom line, agent clash, audio, compaction, storage, move, sweep,
  zero tokens).
- `node …/live-sessions/test.mjs` 4, `npx -y tsx …/web/core-check.mts` 11.
- Real data: this session's own transcript through the hook reader + converter: 334 lines → 262 events, no secrets
  left, largest post 1.29 MB (cap 1.2 MB of lines; the console takes 2 MB).
- Console `tsc --noEmit` clean; check-theme, check-controls, check-toolbars, check-plugin-pages, help-coverage (100 %),
  plugin-catalog, plugin-commands, menu-reach, plugins.mjs, project validate, plugin-lifecycle (only local untracked
  brief files flagged) all pass. The server part loads in `main.PLUGINS` (`server: loaded`).

## Screenshots

`_claude/builds/reports/live-sessions-plugin/shots/after/` (grid phone + desktop, settings desktop), UI Review group
`live-sessions-plugin - Nov 4 5:17 PM` (non-blocking). The shot harness has no Brett session, so it shows the helper
view (Watch live greyed).

## Not done / gaps (said straight)

- **Phase order (addendum 7):** Brett asked for the eavesdropper alone in its own PR first, then phase 2 in follow-ups.
  I only read addenda 6–9 in `.brief.md` after phases 1–2 were already written and tested, so this one PR carries both.
- **Live voice needs a new AmberX build (APK):** AmberX's recorder sends 30-minute chunks to axHub; nothing posts short
  live segments to `sessions/{id}/audio` yet. Until AmberX does, voice is recorded/played back only, not live.
  Not tested against a live human voice call (no phone in a headless run).
- **Addendum 6 (audio editor, clips library):** not started. It is phase 2+ work for a follow-up step.
- AmberX overlay = the bell alert pushed through AmberX, not a dedicated overlay; claude.ai can't show the notice in-chat.
- "Its own container" is a dedicated folder on the console's data volume; one-tap Coolify `axf-recordings` container
  not built. Per-target retention/caps are stored on the targets but only the working store enforces them.
- Drag a build onto a card (send to that session) waits for handoff-2; it can subscribe to `axf.claude-live@1`.
- The hook isn't installed on any machine yet (`live.mjs hook-config` prints the block); `AXF_TOKEN` must be in the shell.
