<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md lines=26-33 tokens=176 -->
### axHub (`e8c9b68`)
- `packages/server/src/data-api.ts`: `GET/PUT /data/:project/*path`, `GET /data/:project`, `GET /data-events?watch=`;
  `DataChangeFeed` wraps the data store (`main.ts`) so MCP tools / claude-sync writes also notify. Auth: admin session
  read+write, user session read (+ write with `data.write`), MCP bearer both; browser writes need the hub's Origin or
  `AXHUB_DATA_ORIGINS` (CORS with credentials; cookie-domain https origins pass).
- `web.ts`: hub pages take their CSS palette from the document (`paletteFromDocument` / `setHubPalette`, colour literals only).
- `data.write` is a default users-page switch. Tests `data-api.test.ts` (9); 311 in all. Decision #88, roadmap, docs.
