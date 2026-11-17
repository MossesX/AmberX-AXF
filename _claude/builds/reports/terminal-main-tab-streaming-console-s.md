# Terminal: a main tab streaming the console's connection to Claude in real time

Build `terminal-main-tab-streaming-console-s`, Phase 1 (Opus), Nov 17 2026.

Brett said (verbatim): "Give terminal a main tab that outputs in real time the console's connection to cloud."

## What was added

Every Terminal window now opens with a pinned first tab, **Claude link**. It can't be closed, renamed, duplicated or
dragged out, and it always stays first. It is a live, read-only log of everything the console does with Claude and
axHub: launches, which account a run got, limit hand-offs, exits and crash lines, console MCP calls, axHub calls with
their held / veto / denied / ok / error state, connects, disconnects and auth failures.

- **Server bus** (`plugins/console-terminal/server/claude_link.py`): an in-memory ring (setting `claudeLinkBuffer`,
  default 2000, 100–20000) plus a JSONL tail at `<dataDir>/claude-link/events.jsonl` written through `data_store`
  (data-store@1, `plugins/console-terminal`), trimmed as it grows. `append()` validates claude-link-event@1 and
  redacts values under secret-looking keys plus bearer tokens, `sk-ant-…`, `ghp_…`, `github_pat_…`, JWTs and long
  opaque strings anywhere in text. Clear moves a view marker (`view.json`); the log is kept.
- **Capability** `axf.claude-link@1` (`append`, `snapshot`, `state`, `subscribe`, `router`) in plugin_services. The
  console mounts its routes a second time at `/api/claude-link` (main.py `CAPABILITY_MOUNTS`), so the framework CLI
  and the emitter never name the plugin folder.
- **REST + SSE** (`server/routes.py`): snapshot with `since / kind / q / limit / all`, `stream` (SSE: `hello` with the
  state and view, `link` per event, `view` when pause / filters change elsewhere, a ping every 15 s, `Last-Event-ID`
  resume), `state`, `clear`, `view` (GET/PUT), `pause`, `resume`, `filter`, `ingest`.
- **Web**: `ClaudeLinkTab.tsx` (rows: time, kind chip, source, account / model, session, summary; tap for detail; a
  Live / reconnecting chip and an axHub answers / unreachable chip), `claudeLinkToolbar.tsx` (role="toolbar",
  settings id `terminal.claude-link`: Pause / Resume, kind chips (multi-select), text filter, Clear), `claude-link.ts`
  (one EventSource per page, reconnects and resumes). Scrolling up pauses by itself; an "N new" button jumps back.
  Three layouts: dense rows (default), cards, split detail (setting `claudeLinkLayout`, the UI Review choice).
- **Settings → Plugins → Terminal → Claude link tab**: layout, follow new events, rows open with detail, kinds shown
  by default, events kept in memory; each with its level for the level toolbar; saved in the Terminal's settings store
  (the same validated path as every other Terminal setting, `PUT …/settings`).

## Event sources

| Source | Kinds | Hook |
|--------|-------|------|
| console → axHub `/mcp` (agent-manager hubtools, claude-session, maintenance, console-commands wake, plugins-menu) | `axhub`, `connect`, `disconnect`, `error` (401/403) | one listener on `axf_server.http.observe()` (new, generic: headers are never passed to observers), `server/hub_watch.py` |
| console → Anthropic API | `connect`, `disconnect`, `error` | the same listener (no line per call) |
| console's own `/mcp` server | `mcp` (caller session, tool, ok / error, ms); `error` on a wrong bearer token | `mcp_server.feed_recorder`, `main.py _McpEndpoint` |
| headless launches | `launch`, `account` (login, limit hand-off), `exit` (code, kind, cost), `error` (last error lines of the run log) | `deploy/claude-headless.sh event()` → `framework/cli/claude-link-emit.mjs --headless` (detached) |
| worker accounts | `account` (run / queue pick), `error` (none free, auth limit) | `deploy/claude-workers.mjs claim / limit` |
| agent slots | `launch` (take, queue), `exit` (release) | `framework/cli/agent-slots.mjs` CLI |

Senders outside the console use `claude-link-emit.mjs`: POST to `AXF_CLAUDE_LINK_URL` (default
`$AXF_CONSOLE_URL/api/claude-link/ingest`) with `AXF_TOKEN`; without a token or when the console is down the line is
appended to the spool (`.axf-console/claude-link-spool.jsonl`), which the bus drains on its next read.
`AXF_CLAUDE_LINK=off` switches it off (every test that runs the launcher sets it).

## How each part is reached

| | |
|---|---|
| Deep link | `?view=terminal&tab=claude-link` (or `#/terminal?tab=claude-link`) |
| control@1 | `view:terminal/tab:claude-link` (registered at load, opens the Terminal), inside it `setting:paused`, `setting:kinds`, `setting:q`, `button:pause`, `button:resume`, `button:clear`, `button:jump`, `button:kind-<kind>`, `panel:status`; `console_show` / `console_open` take the address |
| REST | `/api/plugins/console-terminal/claude-link…` and the same under `/api/claude-link…` |
| MCP | `console-terminal_claude_link_tail`, `_state`, `_clear`, `_pause`, `_resume`, `_filter`, `_view`, `_view_set`, `_ingest`, `_open` (plugin-commands@1) |
| CLI | `axf claude-link tail [--follow] [--kind a,b] [--q words] [--limit n] [--json]`, `state`, `clear`, `open`, `pause`, `resume`, `filter` |
| Voice (AmberX) | "show the Claude link" (control@1 target label + keywords, action `claude-link.open`), "what's Claude doing" (keyword on the target; command `claude-link-state`, action `claude-link.state`) |
| Console actions | `claude-link.open`, `.state`, `.pause`, `.resume`, `.filter:<kinds>[:<text>]`, `.clear` |

## Lifecycle and registries

- Uninstall removes the dataDir (with `claude-link/`) and the spool outside it (`hooks.mjs`); `checks` report the log
  and spool. Marked lines outside the plugin: `framework/cli/axf.mjs`, `.github/workflows/android.yml`.
- help.json entries for the tab and its controls; README section; notify types `terminal.claude-link.disconnect` and
  `terminal.claude-link.error`, off on every channel by default.
- Tests: `server/test_claude_link.py` (ring, JSONL trim, spool, view marker, redaction, REST + SSE + capability mount,
  axHub observer, settings, the MCP recorder; in CI), `framework/cli/claude-link-emit.test.mjs` (a fake headless launch →
  launch / account / hand-off / exit / error, ingest with the token, spool; in CI). The plugin's own `test.py` still
  passes (140 checks).

## UI Review

Three layout options (ui-choices@1 set `claude-link-layout`, assets in `plugins/console-terminal/assets/settings/`):
dense rows, cards, split detail; desktop and phone shots, live, paused, filtered and empty, from
`apps/console-web/plugins/console-terminal/scripts/claude-link-shots.mjs` (vite preview, mocked SSE). Waiting for Brett's pick; dense is the
default until then.

## Also fixed on the way

- The glossary check was over its ratchet on main (392 undescribed, 388 allowed): four CLI tools whose header the
  catalog can't read (`app-screens`, `rebuild-shots`, `rebuild-android-shots` use `//` headers; `plugin-catalog`'s runs
  past the 4000-character window) got a one-line `/** */` summary. Now 388.
- Tests that run the headless launcher or agent slots set `AXF_CLAUDE_LINK=off`, so no test posts to the real console.

## Checks run

check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, check-plugin-commands,
plugin-lifecycle check (clean), glossary catalog --check + test.mts, console `npm run build` (tsc + vite),
`test_claude_link.py` (26 tests), the plugin's `test.py` (140), `claude-link-emit.test.mjs` (18), `axf_server/test.py`
(397), `test_mcp_tools.py` (222), `tests/test_console_control.py`. `deploy/claude-workers.test.mjs` could not run here:
the VPS hard build limit was full (8/8), which refuses its end-to-end launch before any changed code runs; CI runs it.

## Known gaps

- The notify types are registered but nothing raises them yet (off by default anyway); a later step can post them from
  the bus on disconnect / error.
- Voice has no dedicated phrase file: phrases reach the control@1 target and the commands' descriptions, which is how
  the wake listener and AmberX match today.
- Anthropic API traffic is shown as health (connect / disconnect / error), not per call.
