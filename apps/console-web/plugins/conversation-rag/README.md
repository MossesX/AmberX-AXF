# Conversations (conversation-rag)

Brett (Nov 10 2026): "You better make some type of RAG database for this conversation."

Brett (Nov 10 2026): "I don't need the whole entire session quoted and plugged in, that costs me a shitload of money.
Just a brief summary of what you don't do. A two field RAG format, an entry and a value, that's it."

Two-field notes pulled out of every conversation with Brett. Each entry is **entry** (the rule, mistake or decision in a
few words, ≤ 60 chars) and **value** (one line, ≤ 160 chars: what not to do, what to do instead).

- **Sources:** Claude Code chats (`~/.claude/projects/*/*.jsonl`, incremental, newest first; headless build runs are
  skipped except Brett's verbatim quote), claude.ai exports (`conversations.json` in `<dataDir>/imports/` or
  `POST import`), and transcribed session recordings through the `axf.session-transcripts@1` service.
- **Extraction:** plain rules, zero tokens. Brett's sentences that state a rule (`never`, `always`, `I don't need`…), a
  mistake (`you didn't`, `you forgot`, `you keep`…) or a decision become entries; a following "Just …" / "Instead …"
  sentence becomes the do-instead half. With the `ai` switch on, the model may tidy up to 20 new entries per round,
  seeing one sentence each, never a session.
- **Store:** `<dataDir>/conversations.db` (SQLite): the entries, plus one row per session (title, dates, link). Session
  text (passages) is **not stored** unless `passages` is on; switching it off deletes it.
- **Briefs:** published to `/projects/_shared/_data/claude/conversation-ledger.json` (`conversation-ledger@1`, entries
  `{entry, value, pinned?}`). `framework/cli/rules-brief.mjs` adds the pinned entries plus the entries that match the
  task (shared word stems, entry key weighted) as the last rules brief: 12 at most, ~1200 chars. Never passages.

## API (REST `/api/plugins/conversation-rag/…`; the same commands over MCP, CLI and voice via plugin-commands@1)

| Route | What |
|---|---|
| `GET status` | counts, last run, settings |
| `POST reindex {full?}` | read what is new now |
| `GET search?q=&source=&since=&until=&build=&session=&limit=` | matching entries (+ passages only with `passages` on) |
| `GET find-session?q=` | sessions ranked by their matching entries, with their deep link |
| `GET context?q=` | the matching `entry: value` lines for an agent (+ AI answer when switched on) |
| `GET sessions`, `GET session/{id}` | sessions and one session's entries |
| `GET ledger?kind=&q=&hidden=`, `POST ledger/add {entry, value, kind}`, `POST ledger/{id} {entry, value, pinned, hidden}` | the entries |
| `POST import` | a claude.ai export as the body |
| `GET/POST settings` | `ai`, `passages`, `includeHeadless`, `briefLedger`, `briefMaxEntries`, `briefMaxChars`, `minScore`, `everyMinutes` |

Deep link: console view `conversation-rag` (`console_open conversation-rag`). Tests: `python3 apps/console-web/plugins/conversation-rag/test.py`.
