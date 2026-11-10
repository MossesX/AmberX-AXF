# Search bar (console plugin)

The console's one search: a `search-bar` widget renderer plus four built-in bars (globe / gear, full / compact / icon),
any number placed on the banner or toolbars. Matching is its own (`web/match.mjs`, words / prefix / exact / regex);
AI ranking only with an Ollama profile behind `axf.llm@1` **and** the AI switch on. Drop-down: categories left, tree of
matches right; right-click (or →) a setting for its quick options, picked without a confirm.

API: actions `search-bar.*` (see `web/index.tsx` header) on REST / MCP / CLI via plugin-commands@1; reads `GET /state`,
`GET /config`, `GET /ai`. Tests: `node apps/console-web/plugins/search-bar/test.mjs`, `python3 apps/console-web/plugins/search-bar/test.py`.
