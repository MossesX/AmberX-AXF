<!-- memory-chunk@1 source=_claude/memory/docs/harvest/web-client.md tokens=359 -->
## Who uses it now

- `framework/core/assistant.ts` imports the SSE framing and re-exports it (assistant@1 API unchanged; `readSse(body, onEvent)` of the assistant contract is now `readStreamEvents`; nothing outside the file used the old name).
- Console web: `changeBatch.tsx` (`readEventStream` = `readSse` + `sseJson`), `alertsTransport.ts` (`followSse`, 30 s poll kept), agent-manager `streamWorkflow` (`readSse`), ai-assistant streams via `HttpAssistantClient` → shared reader; its JSON calls via `pluginApi` (only its SSE reading and call wrappers changed; `test.py` 137 still passes).
- Console web token: `api.ts`, `plugins.ts` (`pluginFetch` builds headers with `authHeaders(consoleTokens)`), `pluginLifecycle.tsx`, Token dialog.
- Console web types: `api.ts` re-exports the catalog types under the old names (`Status`, `Suggestion`, `InstallableLibrary`, `STATUSES`, `paramDefaultText`, …) and parses every load with the contract parsers; `store.tsx` exposes `libraryCards`; `Libraries.tsx`, `DemosModules.tsx`, `Wizards.tsx` read it.
- Android console: `ConsoleRepo.kt` models are typealiases to `kernel.catalog` (views keep their imports), loading uses `Catalog/Tracker/LibrariesIndex/BoilerplateIndex/Boilerplate.fromJson`; `LibrariesView.kt` + `BoilerplatesView.kt` (`inferModules`) use `repo.libraryCards()`.
- `apiclient` boilerplate installs the library (`libraries: [{ library: "apiclient", params: { tokenKey } }]`).
