# Claude sessions (agent-pick@1)

Every Claude session (voice and chat Amber, Claude Code, headless builds) works **as** a crew agent Brett assigns
(Brett, Nov 3 2026). Built on Opus (orchestrator build `agent-pick`, Urgent profile).

## How a session runs as an agent

1. **Start:** the session calls `claude_session_start` first (MCP; REST `POST /api/plugins/claude-session/session-start`;
   CLI `axf claude-session start --client code --summary "…"`) with `client` (voice | chat | code | headless),
   `summary`, optional `agent` (a headless brief's named agent) and `session` (its own id).
   The answer is the agent to work as now: id, name, avatar, persona / voice notes, `intro` and `env.AXF_AGENT`.
2. **Ask:** with **Ask me every session** on (default), Brett gets the agent picker as a console pop-up, a bell item
   and one held axHub approval (`axf.claude_session_answer`, which reaches his phone through the AmberX app).
   Approving it on axHub = the default agent; picking another agent happens in the console pop-up. Until he answers
   (or for 30 minutes, then it lapses), the session is the **default agent**. Headless builds keep their brief's
   agent with no prompt unless **Ask for headless too** is on.
3. **Who am I:** `claude_session_agent {session}` answers the agent now and `asking` while Brett's pick is pending.
   The session introduces itself by the agent's name and follows its persona / voice notes.
4. **Booking:** `claude_session_book {session, usd, usage?, model?, summary?, commits?, branch?, build?, final?}` puts
   the session's cost, time and commits on the agent's card as a `job` run of type `agent-session` (Agent swarm,
   capability `axf.crew@1`); `final: true` closes it and posts the report in the group chat. A session that never
   started books by `agent` (its `AXF_AGENT`).

Only Brett answers an ask: his own signed-in click in the console, or the axHub approval carrying the ask's ticket.
Tickets are never shown to a session.

## Where it shows

- **Picker** (`claude.picker` dialog; context menu **Choose Claude's agent…** everywhere, Plugins menu, settings):
  every agent with avatar, Working / Idle, current job, today's cost, hours, pay, rating; tap a row for every stat
  (jobs, success / fail, average cost and time, recent runs, write-ups, raises, persona / voice) and links to the
  card, history, Session browser, Terminal and group chat. One tap on **Pick** picks.
- **Assign to Claude:** under every crew card and on the profile (slot `swarm.agent.actions`), and in the agent
  right-click menu (context target `agent`, from crew-live's `AgentAvatar`).
- **Settings → Plugins → Claude sessions:** Claude agent (the default), Ask me every session, Ask for headless too,
  recent sessions.

## Commands (declared once: REST + MCP + CLI through plugin-commands@1)

| MCP | REST | What |
|---|---|---|
| `claude_session_start` | `POST /session-start` | start a session as an agent |
| `claude_session_agent` | `GET /agent` | who this session is (read) |
| `claude_session_book` | `POST /book` | book cost / time / commits on the agent's card |
| `claude_session_answer` | `POST /answer` | Brett's pick (his click or the axHub approval only) |
| `claude_session_assign` | `POST /assign` | Assign to Claude (the default agent) |
| `claude_session_persona` | `PUT /persona` | an agent's persona / voice notes |
| `claude_session_agent_settings(_set)` | `GET/PUT /agent-settings` | the settings |
| `claude_session_picker`, `claude_session_asks` | `GET /picker`, `GET /asks` | picker rows, waiting asks |

No model is ever called (test: `python3 apps/console-web/plugins/claude-session/test.py`).

## Files and lifecycle

- Code: this folder. Data: `.axf-console/plugins/claude-session/agent-pick.json` (settings, personas, sessions;
  `AXF_CLAUDE_DIR` moves it). Bookings live on the agents' cards (the swarm's `runs.json`).
- Remove: `node apps/console-web/plugins/claude-session/uninstall.mjs --all`.

## Gaps

- The Claude settings plugin (build `claude-settings`) isn't built yet: when it lands, its registry lists these
  three settings (they stay stored here) and `claude_settings_get` includes them.
- follow-amber's console pop-up stream isn't built yet: the picker opens through this plugin's own ask watcher (polls
  `/asks` every 5 s). When follow-amber lands, asks go through its stream instead.
- crew-live (`AgentAvatar`, the `agent` context menu, `agent-swarm.profile`) is on PR #273, not main yet: the picker
  draws faces with the framework card rules and falls back to the Breakroom for the links until it merges.
- Pay shows `$/h` when the crew data carries an hourly rate, else the weekly salary. Rating = the agent's `rating`
  when set, else its success rate on five stars.

## Every session recorded (Nov 6 2026)

`session-start` asks AmberX's recorder to start for voice, chat and code sessions, off the request, so a session never
waits on the phone (`server/recording.py`). The state lands on the session as `recording` {state: asked | joined |
phone-offline | failed, name, group}, shown in Recent sessions with a Transcript button. Sessions no longer call
`amberx.recorder_start` themselves. Setting: `recording.autoStart`.
