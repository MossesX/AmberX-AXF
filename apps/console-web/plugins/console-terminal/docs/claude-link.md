# Claude link (design note)

Build `terminal-main-tab-streaming-console-s`, step s1. A pinned main tab in the Terminal that streams, live and
read-only, the console's connection to Claude: headless session launches and exits, account use, MCP and axHub calls,
connects, disconnects and errors. This note lists where each event comes from and the one shape they all take. Later
steps build the collector, the stream, the tab and the REST / MCP / CLI / voice / deep-link reach on top of it.

## The event (`claude-link-event@1`)

One JSON object per line. Types and the kind list live in `web/claude-link-core.ts`.

| Field | Type | What it holds |
| --- | --- | --- |
| `ts` | number | When it happened, epoch ms (sources that write ISO `at` are converted). |
| `kind` | string | `launch` \| `exit` \| `account` \| `mcp` \| `axhub` \| `connect` \| `disconnect` \| `error` |
| `source` | string | The event source's id from the table below (e.g. `headless`, `console-mcp`). |
| `session` | string | The session it belongs to: a tmux name (`axf-…`, `axt-…`), a chat's session name, else `''`. |
| `account` | string | The saved Claude account's name (`hulu`, `worker-2`…), else `''`. Never an email, token or key. |
| `model` | string | The model the session runs on, else `''`. |
| `summary` | string | One short line for the log row (about 160 characters at most). |
| `detail` | string | More, shown when detail is on: arguments summary, exit kind, the reason, the cost. |
| `level` | string | `info` \| `warn` \| `error` |

Rules for every source:

- **Secret-free.** `summary` and `detail` never carry a token, key, prompt text or command output. MCP arguments go
  through the same summariser the session feeds use (`server/nav.py` `summarise_args`); emails are dropped (the account
  name is enough).
- **Read-only.** The collector only reads what the sources already write. It starts nothing, changes nothing and costs
  no tokens.
- **`error` is a kind of its own**, not only a level: a source that reports a failure that fits no other kind (an
  unreadable event file, an ssh link down) emits `kind: error`. A failed MCP call stays `kind: mcp` with
  `level: error`, so the kind filter still finds it under MCP calls.

## Event sources

| `source` | Where it is read | What it says | Kinds |
| --- | --- | --- | --- |
| `headless` | `$AXF_HEADLESS_DIR/events.jsonl` on the VPS (default `/var/tmp/axf-headless`), appended by `deploy/claude-headless.sh` (`event()`). Lines: `session-start`, `session-login`, `session-part`, `session-end` with `session`, `name`, `step`, `agent`, `model`, `cwd`, `surface`, `at`, `exit`, `kind` (exit kind), `phase`, `account`, `costUsd`. | A headless Claude Code session started, which login it took, moved to another account, or ended (exit code, exit kind, cost). | `launch` (session-start), `account` (session-login, session-part), `exit` (session-end; `level: error` when exit ≠ 0, `warn` on a usage or auth stop) |
| `workers` | `worker-state.json` in `$AXF_CLAUDE_WORKERS` (written by `deploy/claude-workers.mjs`): `limits[name] = { at, until, kind: usage \| auth, reason }`, plus claims and queues. Capability `axf.claude-accounts@1` (`view`, `build_account`) where the Claude accounts plugin is installed. | An account hit its limit or lost its login and is out until a time; it came back; the one build account changed; a job waits in an account's queue. | `account` (`warn` for a limit, `error` for a lost login) |
| `slots` | `state.json` and `runs/<build>.json` (run-status@1) in the agent-slots folder (`framework/cli/agent-slots.mjs`: `enqueue`, `bind`, `finish`, `run-end`), through the agent-cap capability when a plugin provides it. | A start took a slot or joined the queue; how a run ended (exit, signal, kind, limit, account, session). Backs up `headless` when a run died before it wrote `session-end`. | `launch` (queued / started), `exit`, `error` (an orphan slot reaped) |
| `console-mcp` | The console's `/mcp` endpoint (`apps/console-web/server/main.py` `_McpEndpoint`, `mcp_server.py` `feed_recorder`). Every tool call already reaches the Terminal through capability `axf.session-feed@1` (`server/nav.py` `record_call(caller, tool, args, ok, error, ms)`); the caller is the `X-Axhub-Session` header, else `axHub` or `MCP client`. | A chat, voice session or agent called a console MCP tool: the tool, a secret-free argument summary, ok or the error, how long it took. `console_session_note` lines (`note()`) carry the chat's source, agent and model. | `mcp` (`level: error` when the call failed), `connect` (a caller's first call, or its first after a quiet spell), `disconnect` (a caller quiet past the idle window) |
| `axhub` | Capability `axf.hub-runs@1` (the agent manager's `axhub_call` record: `at`, `tool`, `command`, `exit`, `reason`, `agent`, `confirmationId`), read the way `GET hub-runs` reads it today. | The console called out through axHub: the tool, who asked, the reason's title, the exit. The output is never copied into the stream. | `axhub` (`level: error` on a non-zero exit) |
| `terminal` | The plugin's own session log (`sessions.jsonl`, `server/store.py` `log()`: `op` open / close / kill, `kind`, `target`, `seconds`, `reason`) and the session manager (`server/sessions.py`). | A Claude Code tab opened or closed on a connection (console, VPS, container, axHub), a tmux session was killed, the ssh link to the VPS dropped or came back. Only `kind: claude` tabs and the VPS link count; plain shells are left out. | `connect`, `disconnect`, `launch` and `exit` (interactive Claude Code tabs), `error` (ssh link down, no key, host not set) |
| `collector` | The collector itself (a later step). | A source could not be read (file missing, capability gone, ssh timeout), lines were dropped because the buffer was full, the stream restarted. | `error`, `connect` / `disconnect` (the stream's own state) |

Known gaps, carried from the sessions nav: axHub does not pass the caller's session to downstream MCP servers, and its
audit log is only readable from a signed-in browser, so calls a chat makes to *other* axHub services are not in the
stream; only its console calls are. The Anthropic API traffic of a session itself is not observable from the console:
`launch`, `account` and `exit` (with cost from the meter) stand in for it.

A source whose plugin is not installed (`axf.claude-accounts@1`, `axf.hub-runs@1`, the agent cap) is simply silent:
the collector asks for capabilities by name and never names a plugin folder.

## Settings (Settings → Plugins → Terminal → Claude link)

The settings page has two tab levels (Settings → Plugins → Terminal), so the Claude link settings are their own
section of the Terminal sub-tab: the settings-registry group `terminal.claude-link` (`web/claude-link.ts`). The
registry draws the controls, saves the values (`rt.settings`, per browser) and makes each one a control target, so
REST, MCP, the CLI and voice read and change them like any other setting.

| Key | Control | Default | Range | Level |
| --- | --- | --- | --- | --- |
| `terminal.claudeLink.autoScroll` | Switch | on | | Simple |
| `terminal.claudeLink.kinds` | Multi-choice of the eight kinds | all eight | none picked = all | Basic |
| `terminal.claudeLink.showDetail` | Switch | off | | Basic |
| `terminal.claudeLink.buffer` | Slider | 1000 lines | 100 to 10000, step 100 | Developer |

Levels sit in the plugin's settings asset (`assets/settings/default-console-terminal.json`, `levelOf`) so the level
toolbar and the level editor see them; `LEVELS` in `web/claude-link-core.ts` is the same map for code. The tab reads
the four values with `claudeLinkPrefs(rt)`; saved values that are out of range or unknown fall back safely
(`cleanBuffer`, `cleanKinds`). Check: `npx -y tsx apps/console-web/plugins/console-terminal/claude-link.test.mts`.

The buffer size here is how many lines the tab keeps on screen. How many lines the server keeps for replay is the
collector's own bound, set when the collector is built.
