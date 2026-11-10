# Conversations (conversation-rag)

Brett (Nov 10 2026): "You better make some type of RAG database for this conversation."

A local search index (RAG store) of every conversation with Brett, and a rules ledger every brief carries.

- **Sources:** Claude Code chats (`~/.claude/projects/*/*.jsonl`, incremental, newest first; headless build runs are
  skipped except Brett's verbatim quote), claude.ai exports (`conversations.json` in `<dataDir>/imports/` or
  `POST import`), and transcribed session recordings through the `axf.session-transcripts@1` service.
- **Index:** `<dataDir>/conversations.db` (SQLite): passages of a few turns, tagged by date, topics and build ids, with
  FTS5 (BM25) plus a 256-dim local hashed embedding for reranking. No model, no key, no tokens.
- **Rules ledger:** sentences in Brett's own words that state a rule, decision or request. Pin, hide, edit or add by API.
  Published to `/projects/_shared/_data/claude/conversation-ledger.json` (`conversation-ledger@1`); `framework/cli/rules-brief.mjs`
  adds it as the last rules brief, so every orchestrator dispatch and headless run carries it.
- **AI:** only `context` uses a model, behind the `ai` setting (off by default).

## API (REST `/api/plugins/conversation-rag/…`; the same commands over MCP, CLI and voice via plugin-commands@1)

| Route | What |
|---|---|
| `GET status` | counts, last run, settings |
| `POST reindex {full?}` | read what is new now |
| `GET search?q=&source=&since=&until=&build=&session=&limit=` | ranked passages with snippets (recording hits carry `offset` seconds) |
| `GET find-session?q=` | sessions ranked by match, with their deep link |
| `GET context?q=` | a context pack for an agent (+ AI answer when switched on) |
| `GET sessions`, `GET session/{id}` | sessions and one session's passages |
| `GET ledger?kind=&q=&hidden=`, `POST ledger/add`, `POST ledger/{id}` | the rules ledger |
| `POST import` | a claude.ai export as the body |
| `GET/POST settings` | `ai`, `includeHeadless`, `briefLedger`, `briefMaxChars`, `minScore`, `everyMinutes` |

Deep link: console view `conversation-rag` (`console_open conversation-rag`). Tests: `python3 apps/console-web/plugins/conversation-rag/test.py`.
