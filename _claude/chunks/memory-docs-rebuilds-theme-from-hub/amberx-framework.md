<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md tokens=406 -->
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
