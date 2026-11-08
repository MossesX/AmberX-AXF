<!-- memory-chunk@1 source=_claude/memory/docs/harvest/web-client.md lines=77-90 tokens=676 -->
## Build Pilot adoption (read-only here; for a Build Pilot session)

1. Re-bake the framework into `src/axf` (at least `core/sse.ts`, `core/catalog.ts`, `core/assistant.ts`, `core/index.ts`, `libs/apiclient/`). `HttpAssistantClient` then reads streams through the shared reader with no code change.
2. `src/pilot/api.ts`:
   - `export const pilotTokens = createTokenStore({ key: 'build-pilot:token' });` `getToken = () => pilotTokens.get()`, `setToken = (t) => pilotTokens.set(t)`; delete `TOKEN_KEY`.
   - `export { ApiError } from '@axf/libs/apiclient';` (same shape: message + `status`).
   - `const client = createApiClient({ url: (p) => `/api/${p}`, tokens: pilotTokens, preferDetail: true, messages: { unauthorized: 'Set the Build Pilot token first.', unreachable: 'The Build Pilot server is not reachable.', failed: (s) => `Request failed (${s}).` } });` and `const call = client.call`. `preferDetail: true` keeps Build Pilot's rule that a server `detail` wins over the 401 text. One difference: an empty 2xx body returns `{}` instead of `null` (check callers of routes that answer 204).
   - `authFetch(url, init)` → `fetch(url, { ...init, headers: authHeaders(pilotTokens, init), cache: 'no-store' })` (it takes full URLs for the assistant client).
   - `apkDownload(id)` → `client.download(`projects/${encodeURIComponent(id)}/apk/file`, 'app-debug.apk')` (same `Download failed (N).`/detail text; a 401 without detail now says "Set the Build Pilot token first.").
   - `screenshot()` → `URL.createObjectURL(await client.blob(path, undefined, /^image\/(png|jpeg|webp)$/))`; wrap it to keep the old texts (`Screenshot not available (N).`, `Not an image.`).
3. `src/dialogs.tsx`: replace `TokenDialog` with `function PilotTokenDialog({ close }) { const pilot = usePilot(); return <TokenDialog tokens={pilotTokens} close={close} label="Token" description={<>Paste the token set as <code>BP_TOKEN</code> on the Build Pilot server. It stays in this browser.</>} allowForget requireValue saveIcon="lock" autoFocus onChange={() => pilot.reload()} />; }` (the field becomes monospace).
4. `src/pilot/contract.ts`: `CatalogBoilerplate` → `Boilerplate` from `@axf/core/catalog` and map `api.catalog()`'s `boilerplates` through `parseBoilerplate`; `categories` → `BoilerplateIndex['categories']`. Build Pilot's `libraries` rows have `ports: string[]` (server-shaped), unlike library@1's `ports` object: either keep that row type, or have the server pass library@1 through and use `LibraryDescriptor` (`Object.keys(lib.ports ?? {})` where a list is needed). `templates`, `buildOptions`, `assets`, `appDefaults`, `libraryTemplates` stay Build Pilot's own.
5. Run Build Pilot's tests and `npx tsc --noEmit`.
