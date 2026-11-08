<!-- memory-chunk@1 source=_claude/memory/docs/harvest/web-client.md tokens=150 -->
## Left for later

- Python catalog parsers (the console server reads the JSON raw; no Python catalog contract yet) and an Android port of apiclient (placeholder in its library.json).
- More console wrappers that could use `pluginApi`/`createApiClient` but word their messages differently (left as they are): systems-check (`SystemCheck.tsx`, `WhatsNew.tsx`, `panels.tsx`), plugin-manager `InstallView.tsx`, project-wizard, session-checkin, approvals-banner, `pluginLifecycle.tsx` `api()`, `alertsTransport.ts` `call()`.
- `store.tsx` still follows `/api/events` with EventSource (no token involved).
