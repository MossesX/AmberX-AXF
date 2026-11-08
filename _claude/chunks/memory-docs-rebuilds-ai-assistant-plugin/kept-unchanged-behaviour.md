<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md tokens=483 -->
## Kept (unchanged behaviour)
- Plugin id, folder, `plugin.json` provides (`axf.llm@1`, `axf.live-sessions@1`), actions `ai-assistant.open` and
  `ai.chat.start`, view `ai-assistant`, dialog `ai-assistant.chat`, settings tab `ai-assistant` (sub-tab of Plugins),
  every route, every settings key, data dir layout and file formats (`ai-assistant-config@1`, `ai-conversation@1`,
  live-session logs).
- `axf.llm@1` API (`profiles()`, `complete(messages, system, profile, model, tools, params)`, `embed()`): byte for
  byte the same calls; the other plugins' self-tests pass unchanged (claude-badge 17, systems-check 56,
  feature-assist 29, agent-manager 92, plugin-manager 52).
- Providers (18 kinds, 3 protocols, streaming, model lists, tests, stored/env keys, fallback chain), chat features
  (regenerate, edit-and-resend, fork, delete, pin/archive/rename/search, export MD/JSON, import, images + text files,
  console context, slash prompts, compare, usage + daily budget, auto-titles, extended thinking, redaction), tools
  (repo list/read/search, time, calculator, SSRF-guarded web fetch), agents via `axf.agents@1` (prompt, tools, memory,
  recorded turns), write-mode badge, change-batch approval cards with undo, batch outcomes in the next turn, the
  Claude Code MCP bridge (`cli_bridge.py`, per-turn 0700 socket, CLI env stripped of every secret, abs-path deny list,
  Edit/Write/Bash off, throwaway jail for plain-chat users), hub users (`wallUsers`, `assistant.*` permissions,
  owner-only conversations, admin-only batches, per-user daily cap, one running reply per user, admin replying with
  the user's rights, plain-text imports for users, trimmed `/status`, `/me`, `/app` page with CSP), live sessions
  (detached replies, SSE with `id:` seq, replay by seq, 409 while running, restart → `interrupted`, close on purpose).
- `safety.py`, `tools.py`, `cli_bridge.py`, `app.html`, `markdown.tsx`: copied as they were.
