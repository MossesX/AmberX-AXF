# theme-from-hub — settings and look of developer apps from the axHub data server (Fable, Oct 21 2026)

Branches `fable/theme-from-hub` in AmberX-AXF, axHub and Build-Pilot. Not a rebuild of an Opus item: a new cross-repo
feature (Brett's decision of Oct 20 2026, refined twice that night and once more on Oct 21). This report follows the
rebuild-report shape anyway (the GUI changed, so it carries before/after screenshots).

## Summary

- **Theme as data.** The selection (asset id per appearance slot, spacing, hidden chrome, a small palette) is an
  `appearance@1` document at `shared/settings/appearance.json` on axHub's data server (axhub-projects@1 `_data`), read
  and written over a new plain-HTTP **data API** on the hub (`/data/<project>/<path>`, ETag/If-Match, `/data-events`
  SSE). The same mechanism carries any other settings document of a developer app later.
- **Every developer app follows it live**: the Dev Console (web + Android), Build Pilot, the AXHub phone app, and
  axHub's own pages (palette only, no AXF dependency). A change in any of them is written to the document; the others
  re-read on the change feed (web) / on resume + feed (Android).
- **Hub down = the app doesn't run**: a themed-by-default "Waiting for axHub" screen with the reason, the next try
  (1 s → 30 s backoff), Retry and (Android) the hub sign-in. No local fallback, no default-theme run, no cached copy.
- **Opt-in per app**: manifest `developer: { hub }` / `axf init --developer [hub]` → the react-ts and android-compose
  templates attach the source; ordinary AXF apps are untouched. Voice Vault is deliberately out.
- UAC unchanged: `assets.swap` (console: `console.themes` via `bindPrincipal`) decides who may change the look; a
  document the app can't fully honour keeps the app's default for that slot (never a crash); the document is not an
  injection path.

## Added

### axHub (`e8c9b68`)
- `packages/server/src/data-api.ts`: `GET/PUT /data/:project/*path`, `GET /data/:project`, `GET /data-events?watch=`;
  `DataChangeFeed` wraps the data store (`main.ts`) so MCP tools / claude-sync writes also notify. Auth: admin session
  read+write, user session read (+ write with `data.write`), MCP bearer both; browser writes need the hub's Origin or
  `AXHUB_DATA_ORIGINS` (CORS with credentials; cookie-domain https origins pass).
- `web.ts`: hub pages take their CSS palette from the document (`paletteFromDocument` / `setHubPalette`, colour literals only).
- `data.write` is a default users-page switch. Tests `data-api.test.ts` (9); 311 in all. Decision #88, roadmap, docs.

### AmberX framework
- `core/engines/appearance.ts` + Kotlin `engine/AppearanceEngine.kt`: parse / resolve / merge / serialize / palette /
  retry; fixtures `spec/fixtures/appearance.json`; `spec/check-appearance.mts` (74 checks: fixtures, runtime with a fake
  source, `HubAppearanceSource` against a fake hub) and `AppearanceConformanceTest` (3 tests, compiled and run here with
  the Gradle-shipped Kotlin compiler; CI runs it in `:axf-kernel:test`).
- Runtime (TS + Kotlin): `AppearanceSource` contract, `attachAppearanceSource` / `detach…`, `appearanceReady`,
  `appearanceSkipped`, `currentAppearance`; apply through the normal slot / settings paths, push after the UAC gate from
  `swap`, `swapAll`, `setSpacing`, `setSlotHidden`, `reset`; `refreshFromSaved` re-reads the source; `AxfState.appearance`.
- Web: `react/hubAppearance.ts` (`HubAppearanceSource`), `react/components/Waiting.tsx`, `AppShell` renders only the
  waiting screen until ready; `ui/axf.css` `.fx-shell--waiting` / `.fx-waiting`.
- Android: new module **`lib-hub`** (`HubAppearanceSource` on OkHttp with SSE, `HubModule`, `HubCredentials` seam,
  `HubSignInView` + `cookieCredentials`, MockWebServer test), `AxfRoot` waiting screen + sign-in, `AxfActivity.onResume`
  re-read, `AxfManifest.developer`. CI runs `:lib-hub:testDebugUnitTest`.
- Manifest `developer: { hub }` (TS + Kotlin), `axf init --developer [hub]` (CLI, engine-rpc, validate), both templates.
- Catalog: feature `f.appearance.source`, library `ai.amberx.axf.hub` (lib-hub); `rebuild-shots.mjs` gained
  `--web-port`, `--env`, `signIn` (so a shot can run against a local hub).

### Console (web)
- `src/hubAppearance.tsx`: attaches the source with the hub from `/api/me` (`appearanceHub`: `AXF_APPEARANCE_HUB`,
  default = the wall's hub, `off` = none for local dev); Settings → Appearance → **Look from axHub** panel (state,
  version, ids this app doesn't have, who may change it). `App.tsx` installs it. `server/main.py` `/api/me` →
  `appearanceHub`. Theme manager: with a source attached it registers saved themes and re-reads the hub document
  instead of re-applying its local "last applied". `scripts/theme-swap.mjs` stubs `/api/me` with the source off.
- Android console: `HubModule` + `HubSignInView` (hub session cookie from the in-app sign-in).
- AXHub phone app: `HubModule` with the WebView cookie it already holds; waiting screen → its locked hub web view.

### Build Pilot
- Framework re-baked (new `scripts/rebake-framework.mjs`, `axf.lock.json` rewritten the `axf init` way, 101 files;
  `bake-contracts.mjs` re-run on top). Manifest `developer.hub`; `main.tsx` attaches the source (`VITE_AXF_HUB` override).
  Look plugin: "Use this look everywhere" applies the picked colour/style/layout to Build Pilot itself through
  `rt.swapAll`, which writes them to the hub.

## Changed (files touched outside new files)

AmberX: `framework/core/{runtime,types,index}.ts`, `framework/react/{AppShell.tsx,index.ts}`, `framework/ui/axf.css`,
`framework/spec/gen-fixtures.mts`, `framework/cli/{build-engine,axf,engine-rpc,rebuild-shots}.mjs`,
`framework/templates/react-ts/src/main.tsx`, `framework/templates/android-compose/app/{build.gradle.kts,src/main/kotlin/app/App.kt}`,
`framework/catalog/{catalog,status,libraries}.json`, `tracker.json`, `framework/android/settings.gradle.kts`,
`framework/android/axf-kernel/.../runtime/AxfRuntime.kt`, `.../manifest/Manifest.kt`, `framework/android/axf-ui/.../AxfRoot.kt`,
`framework/android/axf-platform-android/.../AxfActivity.kt`, `.github/workflows/android.yml`,
`apps/console-web/src/{App.tsx,axf/**}` (re-bake), `apps/console-web/server/main.py` (one block in `/api/me`),
`apps/console-web/scripts/theme-swap.mjs`, `apps/console-web/plugins/theme-manager/web/index.tsx`,
`apps/console/app/{build.gradle.kts,src/main/kotlin/app/{App,MainActivity}.kt}`,
`apps/axhub-android/app/{build.gradle.kts,src/main/kotlin/.../{App,MainActivity}.kt}`, `CLAUDE.md`, `_claude/memory/decisions.md`.
Not touched: `apps/console-web/src/api.ts`, plugins' `web/api.ts`, `framework/react/components/Controls.tsx` (the harvest agents' files).

## Tests before → after

- axHub: 302 → 311 (data-api 9).
- AmberX web: + `check-appearance.mts` 74; `check-theme` 209 files, console `theme-swap` green, console tsc/vite build
  green, `test_wall_users.py` 56; Kotlin: kernel compiles with explicit API, `AppearanceConformanceTest` 3/3 locally,
  `lib-hub` test written for CI (MockWebServer).
- Build Pilot: contract tests 14, server self-test 282, build + typecheck green, lock checks green.

## Screenshots

`theme-from-hub/shots/{before,after}/` (phone + desktop): `settings-appearance`, `app-tabs`, `theme-manager`, and
after-only `waiting-for-hub` (the console with the hub stopped). After shots were taken against a local axHub
(`--web-port 5199 --env AXF_APPEARANCE_HUB=http://127.0.0.1:18080`, signed in as admin); a swap in the console was
verified on the hub (`GET /data/shared/settings/appearance.json` showed it, and the hub's login page picked up the
palette) and a PUT on the hub was verified to re-theme the console live.

## Known gaps / for Brett

- Android written without a compiler beyond the kernel (lib-hub, axf-ui, apps compile in CI only).
- Build Pilot's Android app doesn't exist yet: its android-compose build gets this by `developer` in its manifest.
- The Android console reaches the hub through an in-app sign-in (session cookie) the same way as the AXHub app; a
  device token issued by the hub is a later option (the `HubCredentials` seam takes a bearer already).
