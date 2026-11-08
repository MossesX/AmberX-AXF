<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md tokens=261 -->
## Security
- Every Opus guard kept (see Kept): console token on every route, 404 when disabled, never on MCP; keys 0600 and
  never returned; masked headers; secret redaction (now the shared `SECRET_PATTERN`); CLI env/deny/jail rules;
  calculator and literal-search bombs; SSRF-pinned fetch; owner-only conversations; admin-only batches; signed wall
  headers; param clamps for users (now `clampUserParams`, fixture-checked on every port).
- Tightened: an external session host is only used when it is *available* (`resolve`), and a broken host can't
  break the host list; a chosen-but-missing host answers 503 instead of silently running locally without notice;
  per-user cap is editable (and visible) in the UI so it can't be forgotten; interrupted text is written only when
  the reply had no `done` and only once.
- Added surface: `POST /providers/reload` (admin-only by the usual route rule, reads two JSON files, no network);
  `<dataDir>/providers.json` is inside the 0700 data dir, so only the console owner can add provider kinds.
