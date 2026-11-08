<!-- memory-chunk@1 source=_claude/memory/docs/harvest/web-client.md lines=36-45 tokens=403 -->
## Guards kept / tightened (and where copies differed)

- Token only in the Authorization header, never in a URL (alerts stream, all plugin calls) — kept. Token storage wrapped in try/catch everywhere (one copy in `plugins.ts` was; `pluginLifecycle.tsx` was; `api.ts` was) — kept in the store.
- Alerts stream: reconnect 2 s doubling to 60 s, reset only after a 2xx stream with a body, 30 s poll fallback, abort on unsubscribe — identical.
- Change-batch stream: a refused stream throws the server's `detail` or `request failed (N)` — identical text (now an `SseHttpError`, still an `Error`).
- The nine `call()` copies were identical except the 404 subject and mcp-client's 401 hint ("Home → Console token") and fable-rebuilds' 404 sentence ("is switched off or…"): each keeps its exact message through `pluginApi` options.
- SSE: the old console loops split `data: ` lines into separate events and required the space; the shared parser follows the assistant@1 rules (multi-line data joined, space optional, comments skipped, CRLF). No console server sends multi-line data, so behaviour is the same.
- **Stricter (both ports now agree):** install-parameter numbers accept plain decimals only (old TS took `0x10`/`Infinity`, old Kotlin took `6d`); error text formats bounds the same (`≥ 1`, `≤ 0.5`); `recommended` must be a real boolean on both ports (old Kotlin accepted `"true"`); download file names from Content-Disposition can't contain `/` or `\` (Build Pilot's copy allowed any).
- Android: a boilerplate saved from the console now keeps its `libraries` and `screenshots` (the old `toJson` dropped them).
