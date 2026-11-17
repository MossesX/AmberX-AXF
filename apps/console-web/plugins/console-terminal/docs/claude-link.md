# Claude link — design note

Brett, Nov 17 2026: "Give terminal a main tab that outputs in real time the console's connection to cloud."

The Terminal gets a pinned first tab, **Claude link**, that streams everything the console does with Claude and
axHub as one live log. This note lists where each event comes from and what an event carries.

## Event (`claude-link-event@1`)

| field     | type   | meaning |
|-----------|--------|---------|
| `id`      | int    | sequence number given by the bus (monotonic per console run; SSE `id:`) |
| `ts`      | int    | epoch ms when it happened (the sender's clock; the bus fills it in when missing) |
| `kind`    | enum   | `launch` · `exit` · `account` · `mcp` · `axhub` · `connect` · `disconnect` · `error` |
| `source`  | string | who reported it: `axhub-client`, `mcp-server`, `headless`, `workers`, `agent-slots`, `ingest` |
| `session` | string | tmux session (`axf-…`), MCP caller session, or `''` |
| `account` | string | Claude account name (never an email or token) |
| `model`   | string | model id when known |
| `summary` | string | one line, ≤ 200 chars |
| `detail`  | object | free-form, redacted, ≤ 8 KB once serialised (tool name, args digest, timing, exit code …) |
| `level`   | enum   | `info` · `warn` · `error` |

`append(event)` validates and redacts: any value under a key that looks secret (`token`, `key`, `secret`,
`password`, `authorization`, `cookie`) becomes `"[redacted]"`, and bearer tokens, `sk-ant-…`, `ghp_…`,
`github_pat_…` and long hex/base64 runs inside strings are masked wherever they appear.

## Event sources

| source | where | kinds | notes |
|--------|-------|-------|-------|
| axHub client | `framework/python/axf_server/http.py` → `observe()` listener; every `POST <hub>/mcp` from the console server (agent-manager `hubtools`, claude-session, maintenance, console-commands wake, plugins-menu) | `axhub`, `connect`, `disconnect`, `error` | tool name from the JSON-RPC body (`tools/call` → `params.name`), status, ms, held / veto / result state read from the answer. First success after a failure = `connect`; a failure after success = `disconnect`; 401/403 = `error` (auth). One hook instead of one per call site. |
| console MCP server | `apps/console-web/server/mcp_server.py` `feed_recorder()` (on_call) and `main.py` `_McpEndpoint` | `mcp`, `error` | caller session, tool, ok / error, ms. A wrong bearer token on `/mcp` = `error` (auth failure). |
| headless launches | `deploy/claude-headless.sh` `event()` (session-start, session-login, session-part, session-end) | `launch`, `account`, `exit`, `error` | through `framework/cli/claude-link-emit.mjs`; exit code + kind (phase-done / crash / stopped), stderr error lines on a non-zero exit. |
| worker accounts | `deploy/claude-workers.mjs` `claim` / `limit` | `account`, `error` | account picked (run / queue), limit hand-off (usage / auth). |
| agent slots | `framework/cli/agent-slots.mjs` `claim` / `enqueue` / `release` | `launch`, `exit` (slot level) | `detail.slot`: take, queue, release. |

## Transport

- **In-process** (console server): capability `axf.claude-link@1` in `plugin_services` (`append`, `snapshot`,
  `state`, `subscribe`). Nothing imports the plugin folder.
- **Out-of-process** (VPS scripts): `framework/cli/claude-link-emit.mjs` POSTs to `AXF_CLAUDE_LINK_URL` (default
  `$AXF_CONSOLE_URL/api/claude-link/ingest`, a console route that hands the event to the capability) with
  `AXF_TOKEN`. On failure it appends the line to `AXF_CLAUDE_LINK_SPOOL` (default `<repo>/.axf-console/claude-link-spool.jsonl`);
  the bus drains the spool into its log on its next read. The helper never names the plugin folder and never fails
  the caller.

## Storage

- Ring buffer in memory: `claudeLinkBuffer` setting, default 2000, 100…20000.
- JSONL tail: `<dataDir>/claude-link/events.jsonl` through `data_store` (data-store@1, key namespace
  `plugins/console-terminal`), trimmed to 5× the ring when it grows past 10×.
- Clear = a view marker (`<dataDir>/claude-link/view.json` → `clearedAt` id); the log is kept.

## API (all four the same)

- REST `/api/plugins/console-terminal/claude-link` (snapshot: `since`, `kind`, `q`, `limit`), `/stream` (SSE,
  heartbeat 15 s, `Last-Event-ID` resume), `/state`, `POST /clear`, `POST /ingest`, `GET|PUT /view` (pause, filters).
- Plugin commands → MCP tools `console-terminal_claude_link_*`; CLI `axf claude-link tail|state|clear|open`; voice
  ("show the Claude link", "what's Claude doing"); deep link `?view=terminal&tab=claude-link`; control@1 address
  `view:terminal/tab:claude-link`.
