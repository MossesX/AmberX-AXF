<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md lines=78-84 tokens=139 -->
## Server (console token on every method, 404 when the plugin is off, never on MCP)

`GET entries?open=1|closed=1&kind=&state=&repo=&q=&from=&to=&cursor=&limit=` · `GET entries/{id}` · `POST entries`
(unknown fields refused; an existing id returns it unchanged) · `PATCH entries/{id}` (`steps` whole, `step` upsert,
`result` merged) · `POST entries/{id}/close|reopen` · `POST close-all {ids?}` · `GET where`. Bodies ≤ 128 KB.
Provides `axf.changes@1` (open, update, close, reopen, get, query) so other plugins can record changes without naming this one.
