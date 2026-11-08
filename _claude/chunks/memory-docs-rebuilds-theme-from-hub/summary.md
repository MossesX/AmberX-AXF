<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md lines=7-23 tokens=361 -->
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
