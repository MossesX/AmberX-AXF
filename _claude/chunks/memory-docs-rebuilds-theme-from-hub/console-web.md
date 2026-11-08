<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md lines=51-59 tokens=199 -->
### Console (web)
- `src/hubAppearance.tsx`: attaches the source with the hub from `/api/me` (`appearanceHub`: `AXF_APPEARANCE_HUB`,
  default = the wall's hub, `off` = none for local dev); Settings → Appearance → **Look from axHub** panel (state,
  version, ids this app doesn't have, who may change it). `App.tsx` installs it. `server/main.py` `/api/me` →
  `appearanceHub`. Theme manager: with a source attached it registers saved themes and re-reads the hub document
  instead of re-applying its local "last applied". `scripts/theme-swap.mjs` stubs `/api/me` with the source off.
- Android console: `HubModule` + `HubSignInView` (hub session cookie from the in-app sign-in).
- AXHub phone app: `HubModule` with the WebView cookie it already holds; waiting screen → its locked hub web view.
